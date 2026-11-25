import { defineMigration, type MigrationContext } from '@nocobase/db';

async function finishSqliteRebuild(connection: MigrationContext['connection']) {
  if (connection.dialect !== 'sqlite') return;
  const client = await connection.client<{ raw(sql: string): Promise<unknown> }>();
  const violations = await client.raw('PRAGMA foreign_key_check');
  if (!Array.isArray(violations) || violations.length) throw new Error('Category migration failed foreign-key verification.');
  // Rebuilding a referenced table leaves SQLite's deferred counter stale even
  // when the restored schema passes the actual FK check. Clear only that counter;
  // foreign_keys stays enabled and the migration remains transactional.
  await client.raw('PRAGMA defer_foreign_keys = OFF');
}

export default defineMigration({
  name: '202611220002_material_category_management',
  async up({ builder, query, connection }) {
    // SQLite rebuilds altered tables. Defer FK checks to transaction commit,
    // after the replacement table and its retained rows have been restored.
    if (connection.dialect === 'sqlite') await (await connection.client<{ raw(sql: string): Promise<unknown> }>()).raw('PRAGMA defer_foreign_keys = ON');
    await builder.alterCollection('md_material_categories', (collection) => {
      collection.text('description').notNull().defaultTo('');
      collection.integer('sortOrder').notNull().defaultTo(0);
      collection.optimisticLock('version');
    });
    await builder.createCollection('md_material_category_tree_lock', (collection) => {
      collection.string('id', { length: 32 }).notNull();
      collection.datetimeTz('updatedAt').notNull();
      collection.primary('id', { name: 'pk_md_material_category_tree_lock' });
    });
    await query.insertInto('md_material_category_tree_lock').values({ id: 'tree', updatedAt: new Date() }).execute();
    await builder.createCollection('md_material_category_events', (collection) => {
      collection.string('id', { length: 100 }).notNull();
      collection.string('categoryId', { length: 36 }).notNull();
      collection.string('kind', { length: 24 }).notNull();
      collection.string('actorId', { length: 64 }).nullable();
      collection.string('actorName', { length: 200 }).nullable();
      collection.text('body').nullable();
      collection.json('changes').nullable();
      collection.string('replyToId', { length: 100 }).nullable();
      collection.datetimeTz('createdAt').notNull();
      collection.datetimeTz('updatedAt').notNull();
      collection.datetimeTz('editedAt').nullable();
      collection.datetimeTz('deletedAt').nullable();
      collection.integer('version').notNull().defaultTo(1);
      collection.optimisticLock('version');
      collection.primary('id', { name: 'pk_md_material_category_events' });
      collection.index(['categoryId', 'createdAt'], { name: 'ix_md_material_category_events_category' });
      collection.foreignKey('replyToId', { name: 'fk_md_material_category_events_reply', references: { collection: 'md_material_category_events', fields: ['id'] } });
    });
    // This describes pre-existing rows at their original time, not newly created records.
    const existing = await query.selectFrom('md_material_categories').select(['id', 'createdById', 'createdAt']).execute();
    for (const category of existing) await query.insertInto('md_material_category_events').values({
      id: `initial:${String(category.id)}`, categoryId: category.id, kind: 'initial', actorId: category.createdById,
      actorName: null, body: null, changes: null, replyToId: null, createdAt: category.createdAt,
      updatedAt: category.createdAt, deletedAt: null, editedAt: null,
    }).execute();
    await finishSqliteRebuild(connection);
  },
  async down({ builder, connection }) {
    await builder.dropCollection('md_material_category_events');
    await builder.dropCollection('md_material_category_tree_lock');
    if (connection.dialect === 'sqlite') await (await connection.client<{ raw(sql: string): Promise<unknown> }>()).raw('PRAGMA defer_foreign_keys = ON');
    await builder.alterCollection('md_material_categories', (collection) => {
      collection.clearOptimisticLock();
      collection.dropField('description');
      collection.dropField('sortOrder');
    });
    await finishSqliteRebuild(connection);
  },
});
