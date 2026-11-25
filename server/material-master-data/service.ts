import { ApiError } from '@nocobase/app-server/router';
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { AuthorizationContext } from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import type { DatabaseConnection } from '@nocobase/db';
import type {
  CategoryInput,
  Material,
  MaterialCategory,
  MaterialInput,
} from '../../shared/material-master-data.js';
import { categoryCollection, materialCollection } from './resources.js';
import { categoryEvent, lockCategoryTree } from './category-storage.js';

export const materialError = (
  reason: string,
  status:
    'NOT_FOUND' | 'ALREADY_EXISTS' | 'PERMISSION_DENIED' | 'INVALID_ARGUMENT',
  field?: string,
) =>
  new ApiError({
    status,
    reason,
    domain: 'materials',
    message: reason,
    ...(field ? { fieldViolations: [{ field, description: reason }] } : {}),
  });

export class MaterialMasterDataService {
  constructor(
    readonly connection: DatabaseConnection,
    readonly authorization: AppAuthorization,
  ) {}

  async repository(
    collection: string,
    context: AuthorizationContext,
    action: string,
    transaction = this.connection,
  ) {
    const resource =
      collection === categoryCollection &&
      action !== 'materialCreate' &&
      action !== 'materialEdit'
        ? 'masterData.categories'
        : 'masterData.materials';
    const operation =
      action === 'materialCreate'
        ? 'create'
        : action === 'materialEdit'
          ? 'edit'
          : action;
    const decision = await context.authorize({
      resource: { type: 'composite', id: resource },
      action: operation,
    });
    if (decision.effect === 'deny')
      throw materialError('AUTHORIZATION_DENIED', 'PERMISSION_DENIED');
    const policy = await this.authorization.database.policyFor(
      collection,
      context,
      { resource, action: operation },
    );
    return transaction.repository(collection).withPolicy(policy);
  }

  async categories(context: AuthorizationContext) {
    const repository = await this.repository(
      categoryCollection,
      context,
      'view',
    );
    return (await repository.findMany({
      sort: (s) => [
        s.field('sortOrder').asc(),
        s.field('code').asc(),
        s.field('id').asc(),
      ],
    })) as unknown as MaterialCategory[];
  }

  async list(
    context: AuthorizationContext,
    query: { q: string; categoryId?: string; page: number; pageSize: number },
  ) {
    const repository = await this.repository(
      materialCollection,
      context,
      'view',
    );
    let ids: string[] | undefined;
    if (query.categoryId) {
      const categories = await this.categories(context);
      if (!categories.some((category) => category.id === query.categoryId))
        throw materialError('CATEGORY_UNAVAILABLE', 'NOT_FOUND');
      const selected = new Set([query.categoryId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const category of categories)
          if (
            category.parentId &&
            selected.has(category.parentId) &&
            !selected.has(category.id)
          ) {
            selected.add(category.id);
            changed = true;
          }
      }
      ids = [...selected];
    }
    const filter = buildFilter((f) =>
      f.and([
        ...(query.q
          ? [
              f.or(
                ['code', 'name', 'specification', 'drawingNumber'].map(
                  (field) =>
                    f.string(field).includes(query.q, { mode: 'insensitive' }),
                ),
              ),
            ]
          : []),
        ...(ids ? [f.or(ids.map((id) => f.string('categoryId').eq(id)))] : []),
      ]),
    );
    const [data, total] = await Promise.all([
      repository.findMany({
        filter,
        sort: (s) => [s.field('code').asc(), s.field('id').asc()],
        limit: query.pageSize,
        offset: (query.page - 1) * query.pageSize,
      }),
      repository.count({ filter }),
    ]);
    return {
      data,
      meta: { page: query.page, pageSize: query.pageSize, total },
    };
  }

  async one(
    context: AuthorizationContext,
    id: string,
    action = 'view',
    transaction = this.connection,
  ) {
    const repository = await this.repository(
      materialCollection,
      context,
      action,
      transaction,
    );
    const row = await repository.findOne({ filter: { id } });
    if (!row) throw materialError('MATERIAL_NOT_FOUND', 'NOT_FOUND');
    return row as unknown as Material;
  }

  async categoryTarget(
    context: AuthorizationContext,
    id: string,
    action: string,
    transaction: DatabaseConnection,
  ) {
    const repository = await this.repository(
      categoryCollection,
      context,
      action,
      transaction,
    );
    if (!(await repository.findOne({ filter: { id } })))
      throw materialError('CATEGORY_UNAVAILABLE', 'NOT_FOUND', 'categoryId');
  }

  async uniqueCode(
    collection: string,
    code: string,
    transaction: DatabaseConnection,
    exceptId?: string,
  ) {
    // A trusted invariant check: never return the conflicting record or its other fields.
    if (
      await transaction.repository(collection).exists({
        filter: buildFilter((f) =>
          f.and([
            f.string('code').eq(code),
            ...(exceptId ? [f.string('id').ne(exceptId)] : []),
          ]),
        ),
      })
    )
      throw materialError('MATERIAL_CODE_EXISTS', 'ALREADY_EXISTS', 'code');
  }

  async createCategory(
    context: AuthorizationContext,
    input: CategoryInput,
    actor: string,
    id: string,
    transaction: DatabaseConnection,
    actorName = '',
  ) {
    const repository = await this.repository(
      categoryCollection,
      context,
      'create',
      transaction,
    );
    await lockCategoryTree(transaction);
    if (input.parentId)
      await this.categoryTarget(context, input.parentId, 'create', transaction);
    await this.uniqueCode(categoryCollection, input.code, transaction);
    const now = new Date().toISOString();
    const siblings = await transaction.repository(categoryCollection).findMany({
      filter: { parentId: input.parentId },
      select: (s) => s.fields('sortOrder'),
    });
    const record = (
      await repository.createOne({
        values: {
          ...input,
          id,
          sortOrder:
            Math.max(-1, ...siblings.map((row) => Number(row.sortOrder))) + 1,
          createdAt: now,
          updatedAt: now,
          createdById: actor,
          updatedById: actor,
        },
      })
    ).record;
    await categoryEvent(transaction, {
      categoryId: id,
      kind: 'created',
      actor: { id: actor, name: actorName },
      changes: { name: { before: null, after: input.name } },
    });
    return record;
  }

  async saveMaterial(
    context: AuthorizationContext,
    input: MaterialInput,
    actor: string,
    id: string,
    transaction: DatabaseConnection,
    expectedVersion?: number,
  ) {
    const action = expectedVersion === undefined ? 'create' : 'edit';
    const repository = await this.repository(
      materialCollection,
      context,
      action,
      transaction,
    );
    await this.categoryTarget(
      context,
      input.categoryId,
      action === 'create' ? 'materialCreate' : 'materialEdit',
      transaction,
    );
    if (action === 'edit') await this.one(context, id, 'edit', transaction);
    await this.uniqueCode(
      materialCollection,
      input.code,
      transaction,
      action === 'edit' ? id : undefined,
    );
    const now = new Date().toISOString();
    return expectedVersion === undefined
      ? (
          await repository.createOne({
            values: {
              ...input,
              id,
              createdAt: now,
              updatedAt: now,
              createdById: actor,
              updatedById: actor,
            },
          })
        ).record
      : (
          await repository.updateOne({
            filter: { id },
            ifVersion: expectedVersion,
            values: { ...input, updatedAt: now, updatedById: actor },
          })
        ).record;
  }
}

/** PostgreSQL and SQLite unique constraints close the concurrent-create race. */
export function rethrowMaterialConflict(error: unknown): never {
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const code: unknown = Reflect.get(current, 'code');
    if (code === '23505' || code === 'SQLITE_CONSTRAINT_UNIQUE')
      throw materialError('MATERIAL_CODE_EXISTS', 'ALREADY_EXISTS', 'code');
    current = Reflect.get(current, 'cause');
  }
  throw error;
}
