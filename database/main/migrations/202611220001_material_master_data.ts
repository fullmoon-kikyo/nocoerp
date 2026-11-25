import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611220001_material_master_data',
  async up({ builder }) {
    await builder.createCollection('md_material_categories', (collection) => {
      collection.title('物料类别');
      collection.string('id', { length: 36 }).notNull();
      collection.string('code', { length: 64 }).notNull();
      collection.string('name', { length: 100 }).notNull();
      collection.string('parentId', { length: 36 }).nullable();
      collection.integer('version').notNull().defaultTo(1);
      collection.datetimeTz('createdAt').notNull();
      collection.datetimeTz('updatedAt').notNull();
      collection.string('createdById', { length: 64 }).notNull();
      collection.string('updatedById', { length: 64 }).notNull();
      collection.primary('id', { name: 'pk_md_material_categories' });
      collection.unique('code', { name: 'uq_md_material_categories_code' });
      collection.foreignKey('parentId', { name: 'fk_md_material_categories_parent', references: { collection: 'md_material_categories', fields: ['id'] } });
      collection.index('parentId', { name: 'ix_md_material_categories_parent' });
    });
    await builder.createCollection('md_materials', (collection) => {
      collection.title('物料');
      collection.string('id', { length: 36 }).notNull();
      collection.string('code', { length: 64 }).notNull();
      collection.string('name', { length: 200 }).notNull();
      collection.string('categoryId', { length: 36 }).notNull();
      collection.string('specification', { length: 300 }).notNull();
      collection.string('drawingNumber', { length: 100 }).notNull();
      collection.string('unit', { length: 32 }).notNull();
      collection.string('materialGrade', { length: 100 }).notNull();
      collection.text('remarks').notNull();
      collection.boolean('enabled').notNull().defaultTo(true);
      collection.integer('version').notNull().defaultTo(1);
      collection.optimisticLock('version');
      collection.datetimeTz('createdAt').notNull();
      collection.datetimeTz('updatedAt').notNull();
      collection.string('createdById', { length: 64 }).notNull();
      collection.string('updatedById', { length: 64 }).notNull();
      collection.primary('id', { name: 'pk_md_materials' });
      collection.unique('code', { name: 'uq_md_materials_code' });
      collection.foreignKey('categoryId', { name: 'fk_md_materials_category', references: { collection: 'md_material_categories', fields: ['id'] } });
      collection.index('categoryId', { name: 'ix_md_materials_category' });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('md_materials');
    await builder.dropCollection('md_material_categories');
  },
});
