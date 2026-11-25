import { defineCompositeResource } from '@nocobase/authorization/core';
import { defineDatabasePermission } from '@nocobase/app-plugin-authorization/server';

export const categoryCollection = 'md_material_categories';
export const materialCollection = 'md_materials';
const title = (key: string) => ({ key: `materials.${key}`, ns: 'nocoerp-app' });
export const categoryFields = [
  'id',
  'code',
  'name',
  'parentId',
  'description',
  'sortOrder',
  'version',
  'createdAt',
  'updatedAt',
  'createdById',
  'updatedById',
] as const;
export const materialFields = [
  'id',
  'code',
  'name',
  'categoryId',
  'specification',
  'drawingNumber',
  'unit',
  'materialGrade',
  'remarks',
  'enabled',
  'version',
  'createdAt',
  'updatedAt',
  'createdById',
  'updatedById',
] as const;
const editable = [
  'code',
  'name',
  'categoryId',
  'specification',
  'drawingNumber',
  'unit',
  'materialGrade',
  'remarks',
  'enabled',
];
const auditCreate = [
  'id',
  'createdAt',
  'updatedAt',
  'createdById',
  'updatedById',
];
const categories = defineDatabasePermission((p) =>
  p
    .collection(categoryCollection)
    .title(title('categories'))
    .read([...categoryFields]),
);
const materials = defineDatabasePermission((p) =>
  p
    .collection(materialCollection)
    .title(title('title'))
    .read([...materialFields]),
);
export const categoryResource = defineCompositeResource(
  'masterData.categories',
  (r) =>
    r
      .title(title('categories'))
      .action('view', (a) =>
        a.title(title('viewCategories')).grant('categories', categories),
      )
      .action('create', (a) =>
        a
          .title(title('newCategory'))
          .grant(
            'categories',
            categories.create([
              'code',
              'name',
              'parentId',
              'description',
              'sortOrder',
              ...auditCreate,
            ]),
          ),
      )
      .action('edit', (a) =>
        a
          .title(title('editCategory'))
          .grant(
            'categories',
            categories.update([
              'code',
              'name',
              'description',
              'updatedAt',
              'updatedById',
            ]),
          ),
      )
      .action('move', (a) =>
        a
          .title(title('moveCategory'))
          .grant(
            'categories',
            categories.update([
              'parentId',
              'sortOrder',
              'updatedAt',
              'updatedById',
            ]),
          ),
      )
      .action('delete', (a) =>
        a
          .title(title('deleteCategory'))
          .grant('categories', categories.delete()),
      )
      .action('import', (a) =>
        a
          .title(title('importCategories'))
          .grant(
            'categories',
            categories.create([
              'code',
              'name',
              'parentId',
              'description',
              'sortOrder',
              ...auditCreate,
            ]),
          ),
      )
      .action('export', (a) =>
        a.title(title('exportCategories')).grant('categories', categories),
      )
      .action('comment', (a) =>
        a.title(title('commentCategory')).grant('categories', categories),
      ),
);
export const materialResource = defineCompositeResource(
  'masterData.materials',
  (r) =>
    r
      .title(title('title'))
      .action('view', (a) =>
        a.title(title('viewMaterials')).grant('materials', materials),
      )
      .action('create', (a) =>
        a
          .title(title('newMaterial'))
          .grant('materials', materials.create([...editable, ...auditCreate]))
          .grant('categories', categories),
      )
      .action('edit', (a) =>
        a
          .title(title('editMaterial'))
          .grant(
            'materials',
            materials.update([...editable, 'updatedAt', 'updatedById']),
          )
          .grant('categories', categories),
      ),
);
