import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

const id = '20000000-0000-4000-8000-000000000001';
const originalTime = new Date('2026-01-01T00:00:00.000Z');
describeMigration('202611220002_material_category_management', {
  sources: [
    {
      packageName: 'material-category-migration-test',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  before: async ({ connection }) => {
    await connection.query
      .insertInto('md_material_categories')
      .values({
        id,
        code: 'RETAINED',
        name: 'Existing category',
        parentId: null,
        version: 3,
        createdAt: originalTime,
        updatedAt: originalTime,
        createdById: 'original-user',
        updatedById: 'original-user',
      })
      .execute();
    await connection.query
      .insertInto('md_material_categories')
      .values({
        id: '20000000-0000-4000-8000-000000000003',
        code: 'RETAINED-CHILD',
        name: 'Existing child',
        parentId: id,
        version: 1,
        createdAt: originalTime,
        updatedAt: originalTime,
        createdById: 'original-user',
        updatedById: 'original-user',
      })
      .execute();
    await connection.query
      .insertInto('md_materials')
      .values({
        id: '20000000-0000-4000-8000-000000000002',
        code: 'RETAINED-MAT',
        name: 'Existing material',
        categoryId: id,
        unit: 'kg',
        specification: '',
        drawingNumber: '',
        materialGrade: '',
        remarks: '',
        enabled: true,
        version: 2,
        createdAt: originalTime,
        updatedAt: originalTime,
        createdById: 'original-user',
        updatedById: 'original-user',
      })
      .execute();
  },
  up: async ({ connection, expectCollection }) => {
    await expectCollection('md_material_categories').toHaveField(
      'description',
      { nullable: false },
    );
    await expectCollection('md_material_categories').toHaveField('sortOrder', {
      nullable: false,
    });
    await expectCollection('md_material_category_events').toHaveForeignKey(
      ['replyToId'],
      'md_material_category_events',
    );
    const category = await connection
      .repository('md_material_categories')
      .findOne({ filter: { id } });
    expect(category).toMatchObject({
      name: 'Existing category',
      version: 3,
      description: '',
      sortOrder: 0,
    });
    const material = await connection
      .repository('md_materials')
      .findOne({ filter: { code: 'RETAINED-MAT' } });
    expect(material).toMatchObject({ categoryId: id, version: 2 });
    const initial = await connection
      .repository('md_material_category_events')
      .findOne({ filter: { categoryId: id } });
    expect(initial).toMatchObject({
      id: `initial:${id}`,
      kind: 'initial',
      actorId: 'original-user',
    });
    expect(new Date(String(initial!.createdAt)).toISOString()).toBe(
      originalTime.toISOString(),
    );
    expect(
      await connection.repository('md_material_category_tree_lock').count(),
    ).toBe(1);
  },
  down: async ({ connection, expectCollection }) => {
    await expectCollection('md_material_category_events').not.toExist();
    await expectCollection('md_material_category_tree_lock').not.toExist();
    await expectCollection('md_material_categories').not.toHaveField(
      'description',
    );
    expect(
      await connection
        .repository('md_materials')
        .findOne({ filter: { code: 'RETAINED-MAT' } }),
    ).toMatchObject({ categoryId: id, version: 2 });
  },
});
