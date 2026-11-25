import { createHash } from 'node:crypto';
import type { AuthorizationContext } from '@nocobase/authorization/core';
import type { DatabaseConnection } from '@nocobase/db';
import {
  categoryInputSchema,
  type MaterialCategory,
} from '../../shared/material-master-data.js';
import type {
  CategoryImportPreview,
  CategoryImportRow,
} from '../../shared/material-categories.js';
import { categoryCollection } from './resources.js';
import { MaterialMasterDataService, materialError } from './service.js';
import {
  categoryEvent,
  lockCategoryTree,
  type CategoryActor,
} from './category-storage.js';
import { CategoryCsvError, parseCsv, toCsv } from './category-csv.js';

const aliases: Record<string, string> = {
  code: 'code',
  name: 'name',
  parentCode: 'parentCode',
  description: 'description',
  类别编码: 'code',
  类别名称: 'name',
  上级类别编码: 'parentCode',
  备注: 'description',
};
export class CategoryImportService {
  constructor(readonly base: MaterialMasterDataService) {}

  async preview(
    context: AuthorizationContext,
    csv: string,
    tx = this.base.connection,
  ): Promise<CategoryImportPreview> {
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'import',
      tx,
    );
    const visible =
      (await repository.findMany()) as unknown as MaterialCategory[];
    const preview: CategoryImportPreview = { rows: [], errors: [], total: 0 };
    const fail = (line: number, field: string, reason: string) =>
      preview.errors.push({ line, field, reason });
    if (Buffer.byteLength(csv, 'utf8') > 512 * 1024) {
      fail(1, 'file', 'limit');
      return preview;
    }
    try {
      const table = parseCsv(csv);
      const columns = table.columns.map((key) => aliases[key]);
      if (
        !columns.includes('code') ||
        !columns.includes('name') ||
        columns.some((key) => !key) ||
        new Set(columns).size !== columns.length
      ) {
        fail(1, 'file', 'headers');
        return preview;
      }
      preview.total = table.rows.length;
      if (!preview.total || preview.total > 500) {
        fail(1, 'file', 'limit');
        return preview;
      }
      preview.rows = table.rows.map((row, index) => {
        const fields = Object.fromEntries(
          table.columns.map((key) => [aliases[key], row[key] ?? '']),
        );
        return {
          line: table.lineNumbers[index],
          code: fields.code ?? '',
          name: fields.name ?? '',
          parentCode: fields.parentCode ?? '',
          description: fields.description ?? '',
        };
      });
    } catch (error) {
      if (error instanceof CategoryCsvError) {
        fail(error.line, 'file', 'format');
        return preview;
      }
      throw error;
    }
    const existing = await tx
      .repository(categoryCollection)
      .findMany({ select: (s) => s.fields('code') });
    const existingCodes = new Set(
      existing.map((row) => (typeof row.code === 'string' ? row.code : '')),
    );
    const visibleCodes = new Set(visible.map((row) => row.code));
    const byCode = new Map<string, CategoryImportRow>();
    for (const row of preview.rows) {
      // Validate only the persisted public input, not CSV bookkeeping.
      const checked = categoryInputSchema.safeParse({
        code: row.code,
        name: row.name,
        description: row.description,
        parentId: null,
      });
      if (!checked.success)
        for (const issue of checked.error.issues)
          fail(row.line, String(issue.path[0]), 'invalid');
      if (existingCodes.has(row.code) || byCode.has(row.code))
        fail(row.line, 'code', 'duplicate');
      byCode.set(row.code, row);
    }
    for (const row of preview.rows) {
      if (
        row.parentCode &&
        !visibleCodes.has(row.parentCode) &&
        !byCode.has(row.parentCode)
      )
        fail(row.line, 'parentCode', 'parent');
      let at: CategoryImportRow | undefined = row;
      const seen = new Set<string>();
      while (at) {
        if (seen.has(at.code)) {
          fail(row.line, 'parentCode', 'cycle');
          break;
        }
        seen.add(at.code);
        at = byCode.get(at.parentCode);
      }
    }
    return preview;
  }

  async commit(
    context: AuthorizationContext,
    csv: string,
    key: string,
    actor: CategoryActor,
    tx: DatabaseConnection,
  ) {
    await lockCategoryTree(tx);
    const preview = await this.preview(context, csv, tx);
    if (preview.errors.length)
      throw materialError('CATEGORY_IMPORT_INVALID', 'INVALID_ARGUMENT');
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'import',
      tx,
    );
    const visible =
      (await repository.findMany()) as unknown as MaterialCategory[];
    const parents = new Map(visible.map((row) => [row.code, row.id]));
    const all = await tx
      .repository(categoryCollection)
      .findMany({ select: (s) => s.fields('parentId', 'sortOrder') });
    const nextOrder = new Map<string | null, number>();
    for (const row of all) {
      const parent = typeof row.parentId === 'string' ? row.parentId : null;
      nextOrder.set(
        parent,
        Math.max(nextOrder.get(parent) ?? 0, Number(row.sortOrder) + 1),
      );
    }
    const pending = [...preview.rows];
    const created = [];
    while (pending.length) {
      const at = pending.findIndex(
        (row) => !row.parentCode || parents.has(row.parentCode),
      );
      if (at < 0)
        throw materialError('CATEGORY_IMPORT_INVALID', 'INVALID_ARGUMENT');
      const row = pending.splice(at, 1)[0];
      const hash = createHash('sha256')
        .update(`${key}:${row.line}`)
        .digest('hex');
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const parentId = row.parentCode ? parents.get(row.parentCode)! : null;
      const sortOrder = nextOrder.get(parentId) ?? 0;
      nextOrder.set(parentId, sortOrder + 1);
      const now = new Date().toISOString();
      const result = await repository.createOne({
        values: {
          id,
          code: row.code,
          name: row.name,
          description: row.description,
          parentId,
          sortOrder,
          createdAt: now,
          updatedAt: now,
          createdById: actor.id,
          updatedById: actor.id,
        },
      });
      created.push(result.record);
      parents.set(row.code, id);
      await categoryEvent(tx, {
        categoryId: id,
        kind: 'created',
        actor,
        changes: { name: { before: null, after: row.name } },
      });
    }
    return created;
  }

  async export(context: AuthorizationContext, q: string) {
    const repository = await this.base.repository(
      categoryCollection,
      context,
      'export',
    );
    const rows = (await repository.findMany({
      sort: (s) => [s.field('sortOrder').asc(), s.field('code').asc()],
    })) as unknown as MaterialCategory[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const selected = new Set<string>();
    for (const row of rows) {
      if (
        !`${row.code} ${row.name}`
          .toLocaleLowerCase()
          .includes(q.toLocaleLowerCase())
      )
        continue;
      let at: MaterialCategory | undefined = row;
      while (at && !selected.has(at.id)) {
        selected.add(at.id);
        if (at.parentId && !byId.has(at.parentId))
          throw materialError(
            'CATEGORY_EXPORT_PARENT_UNAVAILABLE',
            'PERMISSION_DENIED',
          );
        at = at.parentId ? byId.get(at.parentId) : undefined;
      }
    }
    return toCsv(
      ['code', 'name', 'parentCode', 'description'],
      rows
        .filter((row) => selected.has(row.id))
        .map((row) => ({
          code: row.code,
          name: row.name,
          parentCode: row.parentId ? byId.get(row.parentId)!.code : '',
          description: row.description,
        })),
    );
  }
}
