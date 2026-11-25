import path from 'node:path';
import { describeMigration } from '@nocobase/app-testing/server';
import { expect } from 'vitest';

describeMigration('202611220001_material_master_data', {
  sources: [
    {
      packageName: 'material-master-data-test',
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
    },
  ],
  up: async ({ connection, expectCollection }) => {
    await expectCollection('md_material_categories').toHaveIndex(['code'], {
      unique: true,
    });
    await expectCollection('md_materials').toHaveIndex(['code'], {
      unique: true,
    });
    await expectCollection('md_materials').toHaveField('version', {
      nullable: false,
    });
    await expectCollection('md_materials').toHaveField('categoryId', {
      nullable: false,
    });
    const row = {
      id: '10000000-0000-4000-8000-000000000001',
      code: 'ROOT',
      name: 'Root',
      parentId: null,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdById: 'test',
      updatedById: 'test',
    };
    await connection.query
      .insertInto('md_material_categories')
      .values(row)
      .execute();
    await expect(
      connection.query
        .insertInto('md_material_categories')
        .values({ ...row, id: '10000000-0000-4000-8000-000000000002' })
        .execute(),
    ).rejects.toThrow();
    await expect(
      connection.query
        .insertInto('md_material_categories')
        .values({
          ...row,
          id: '10000000-0000-4000-8000-000000000003',
          code: 'BAD',
          parentId: 'missing-parent',
        })
        .execute(),
    ).rejects.toThrow();
  },
  down: async ({ expectCollection }) => {
    await expectCollection('md_materials').not.toExist();
    await expectCollection('md_material_categories').not.toExist();
  },
});
