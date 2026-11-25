import type { AuthorizationContext } from '@nocobase/authorization/core';
import type { DatabaseConnection } from '@nocobase/db';
import { buildFilter } from '@nocobase/repository-input';
import type { CategoryEvent } from '../../shared/material-categories.js';
import type { MaterialCategory } from '../../shared/material-master-data.js';
import { categoryCollection, materialCollection } from './resources.js';
import { materialError, type MaterialMasterDataService } from './service.js';
import {
  categoryEvent,
  categoryEvents,
  lockCategoryTree,
  type CategoryActor,
} from './category-storage.js';

export class MaterialCategoryService {
  constructor(readonly base: MaterialMasterDataService) {}
  async one(
    context: AuthorizationContext,
    id: string,
    action: string,
    tx = this.base.connection,
  ) {
    const repository = await this.base.repository(
      categoryCollection,
      context,
      action,
      tx,
    );
    const row = await repository.findOne({ filter: { id } });
    if (!row) throw materialError('CATEGORY_UNAVAILABLE', 'NOT_FOUND');
    return row as unknown as MaterialCategory;
  }

  async edit(
    context: AuthorizationContext,
    id: string,
    input: {
      code: string;
      name: string;
      description: string;
      expectedVersion: number;
    },
    actor: CategoryActor,
    tx: DatabaseConnection,
  ) {
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'edit',
      tx,
    );
    const before = await this.one(context, id, 'edit', tx);
    await this.base.uniqueCode(categoryCollection, input.code, tx, id);
    const { expectedVersion, ...fields } = input;
    const result = await repository.updateOne({
      filter: { id },
      ifVersion: expectedVersion,
      values: {
        ...fields,
        updatedAt: new Date().toISOString(),
        updatedById: actor.id,
      },
    });
    const changes = Object.fromEntries(
      (['code', 'name', 'description'] as const)
        .filter((key) => before[key] !== input[key])
        .map((key) => [key, { before: before[key], after: input[key] }]),
    );
    await categoryEvent(tx, {
      categoryId: id,
      kind: 'updated',
      actor,
      changes,
    });
    return result.record;
  }

  async move(
    context: AuthorizationContext,
    id: string,
    input: { parentId: string | null; index: number; expectedVersion: number },
    actor: CategoryActor,
    tx: DatabaseConnection,
  ) {
    await lockCategoryTree(tx);
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'move',
      tx,
    );
    const current = await this.one(context, id, 'move', tx);
    if (current.version !== input.expectedVersion)
      throw materialError('CATEGORY_VERSION_CONFLICT', 'ALREADY_EXISTS');
    if (input.parentId) await this.one(context, input.parentId, 'move', tx);
    const all = (await tx.repository(categoryCollection).findMany({
      sort: (s) => [
        s.field('sortOrder').asc(),
        s.field('code').asc(),
        s.field('id').asc(),
      ],
    })) as unknown as MaterialCategory[];
    const byId = new Map(all.map((row) => [row.id, row]));
    let parent = input.parentId;
    const seen = new Set<string>([id]);
    while (parent) {
      if (seen.has(parent))
        throw materialError('CATEGORY_CYCLE', 'INVALID_ARGUMENT', 'parentId');
      seen.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    const targetSiblings = all.filter(
      (row) => row.id !== id && row.parentId === input.parentId,
    );
    if (input.index > targetSiblings.length)
      throw materialError(
        'CATEGORY_POSITION_INVALID',
        'INVALID_ARGUMENT',
        'index',
      );
    const targetOrder = [...targetSiblings];
    targetOrder.splice(input.index, 0, current);
    const oldOrder =
      current.parentId === input.parentId
        ? []
        : all.filter(
            (row) => row.id !== id && row.parentId === current.parentId,
          );
    const updates = [
      ...oldOrder.map((row, index) => ({
        row,
        index,
        parentId: current.parentId,
      })),
      ...targetOrder.map((row, index) => ({
        row,
        index,
        parentId: input.parentId,
      })),
    ].filter(
      ({ row, index, parentId }) =>
        row.id === id || row.sortOrder !== index || row.parentId !== parentId,
    );
    // Reordering cannot quietly modify a sibling outside the caller's move scope.
    for (const { row } of updates)
      if (!(await repository.findOne({ filter: { id: row.id } })))
        throw materialError('CATEGORY_SCOPE_INCOMPLETE', 'PERMISSION_DENIED');
    let moved: unknown;
    for (const { row, index, parentId } of updates) {
      const result = await repository.updateOne({
        filter: { id: row.id },
        ifVersion: row.id === id ? input.expectedVersion : row.version,
        values: {
          sortOrder: index,
          parentId,
          updatedAt: new Date().toISOString(),
          updatedById: actor.id,
        },
      });
      if (row.id === id) moved = result.record;
    }
    await categoryEvent(tx, {
      categoryId: id,
      kind: 'moved',
      actor,
      changes: {
        parentId: { before: current.parentId, after: input.parentId },
        sortOrder: { before: current.sortOrder, after: input.index },
      },
    });
    return moved;
  }

  async remove(
    context: AuthorizationContext,
    id: string,
    expectedVersion: number,
    actor: CategoryActor,
    tx: DatabaseConnection,
  ) {
    await lockCategoryTree(tx);
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'delete',
      tx,
    );
    const before = await this.one(context, id, 'delete', tx);
    const [children, materials] = await Promise.all([
      tx.repository(categoryCollection).exists({ filter: { parentId: id } }),
      tx.repository(materialCollection).exists({ filter: { categoryId: id } }),
    ]);
    if (children || materials)
      throw materialError('CATEGORY_IN_USE', 'ALREADY_EXISTS');
    await repository.deleteOne({ filter: { id }, ifVersion: expectedVersion });
    await categoryEvent(tx, {
      categoryId: id,
      kind: 'deleted',
      actor,
      changes: { name: { before: before.name, after: null } },
    });
    return { id, deleted: true };
  }

  async history(
    context: AuthorizationContext,
    id: string,
    query: {
      page: number;
      pageSize: number;
      filter: 'all' | 'comments' | 'changes';
    },
  ) {
    await this.one(context, id, 'view');
    const repository = this.base.connection.repository(categoryEvents);
    const filter = buildFilter((f) =>
      f.and([
        f.string('categoryId').eq(id),
        ...(query.filter === 'comments'
          ? [f.string('kind').eq('comment')]
          : query.filter === 'changes'
            ? [f.string('kind').ne('comment')]
            : []),
      ]),
    );
    const [data, total] = await Promise.all([
      repository.findMany({
        filter,
        sort: (s) => [s.field('createdAt').desc(), s.field('id').desc()],
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      repository.count({ filter }),
    ]);
    return {
      data,
      meta: { total, page: query.page, pageSize: query.pageSize },
    };
  }

  async comment(
    context: AuthorizationContext,
    id: string,
    input: { body: string; replyToId?: string },
    actor: CategoryActor,
    tx: DatabaseConnection,
  ) {
    await this.one(context, id, 'comment', tx);
    if (input.replyToId) {
      const parent = await tx.repository(categoryEvents).findOne({
        filter: { id: input.replyToId, categoryId: id, kind: 'comment' },
      });
      if (!parent || parent.replyToId)
        throw materialError('CATEGORY_COMMENT_UNAVAILABLE', 'NOT_FOUND');
    }
    return categoryEvent(tx, {
      categoryId: id,
      kind: 'comment',
      body: input.body,
      replyToId: input.replyToId,
      actor,
    });
  }

  async editComment(
    context: AuthorizationContext,
    id: string,
    commentId: string,
    input: { body?: string; expectedVersion: number },
    actor: CategoryActor,
    tx: DatabaseConnection,
    deleting = false,
  ) {
    await this.one(context, id, 'comment', tx);
    const repository = tx.repository(categoryEvents);
    const row = (await repository.findOne({
      filter: { id: commentId, categoryId: id, kind: 'comment' },
    })) as unknown as CategoryEvent | undefined;
    if (!row || row.deletedAt)
      throw materialError('CATEGORY_COMMENT_UNAVAILABLE', 'NOT_FOUND');
    if (row.actorId !== actor.id)
      throw materialError('CATEGORY_COMMENT_NOT_AUTHOR', 'PERMISSION_DENIED');
    const now = new Date().toISOString();
    return (
      await repository.updateOne({
        filter: { id: commentId, categoryId: id },
        ifVersion: input.expectedVersion,
        values: deleting
          ? { body: '', deletedAt: now, updatedAt: now }
          : { body: input.body, editedAt: now, updatedAt: now },
      })
    ).record;
  }
}
