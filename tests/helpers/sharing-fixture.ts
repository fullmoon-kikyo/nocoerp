import type { TestApp } from '@nocobase/app-testing/server';
import {
  authorizationToken,
  defineDatabasePermission,
} from '@nocobase/app-plugin-authorization/server';
import { defineCompositeResource } from '@nocobase/authorization/core';

/** Synthetic business data exists only in the isolated test application. */
export async function registerSharingFixture(app: TestApp) {
  const authz = app.application.container.resolve(authorizationToken);
  for (const name of ['sharingItems', 'sharingParents']) {
    await app.connection.builder.createCollection(name, (collection) => {
      collection.string('id').notNull();
      collection.string('name').notNull();
      collection.string('secret').nullable();
      collection.string('parentId').nullable();
      collection.primary('id');
    });
    await app.connection.collections.refresh(name);
    authz.database.collections.add({ name, title: name });
  }
  const items = defineDatabasePermission((permission) =>
    permission.collection('sharingItems').read(['id', 'name', 'parentId']),
  );
  const parents = defineDatabasePermission((permission) =>
    permission.collection('sharingParents').read(['id', 'name']),
  );
  const resource = authz.compositeResources.define(
    defineCompositeResource('sharing.acceptance', (resource) =>
      resource
        .title('Acceptance records')
        .action('view', (action) =>
          action.title('View records').grant('items', items),
        )
        .action('edit', (action) =>
          action.title('Edit records').grant('items', items.update(['name'])),
        )
        .action('submit', (action) =>
          action
            .title('Submit records')
            .grant('items', items.update(['name']))
            .grant('parents', parents),
        ),
    ),
  );
  authz.ui.sections.add({
    name: 'sharing-acceptance',
    title: 'Acceptance',
    parent: 'business',
  });
  authz.ui.place(resource, { section: 'sharing-acceptance' });
  for (const id of ['baseline', 'delegated', 'confidential', 'independent']) {
    await app.connection.query
      .insertInto('sharingItems')
      .values({
        id,
        name: `Record ${id}`,
        secret: 'hidden',
        parentId: 'parent-1',
      })
      .execute();
  }
  await app.connection.query
    .insertInto('sharingParents')
    .values({ id: 'parent-1', name: 'Parent record', secret: 'hidden' })
    .execute();
  return { authz, resource };
}
