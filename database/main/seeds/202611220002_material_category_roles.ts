import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';

export default defineSeed({
  name: '202611220002_material_category_roles',
  async run({ query }) {
    for (const manager of [true, false]) {
      const key = manager ? 'material-category-manager' : 'material-category-viewer';
      if (await query.selectFrom('authorizationPermissionSets').select('id').where('key', '=', key).executeTakeFirst()) continue;
      const grants = [
        ...['materials.categories', 'materials.master-data'].map((id) => ({ resource: { type: 'page', id }, actions: [{ action: 'access' }] })),
        { resource: { type: 'composite', id: 'masterData.categories' }, actions: (manager ? ['view', 'create', 'edit', 'move', 'delete', 'import', 'export', 'comment'] : ['view']).map((action) => ({ action, policy: { type: 'composite', scopes: { categories: 'allRecords' } } })) },
        { resource: { type: 'composite', id: 'masterData.materials' }, actions: [{ action: 'view', policy: { type: 'composite', scopes: { materials: 'allRecords' } } }] },
      ];
      const now = new Date();
      await query.insertInto('authorizationPermissionSets').values({ id: key, key, title: encodeAuthorizationTitle({ key: manager ? 'categoryManagement.managerRole' : 'categoryManagement.viewerRole', ns: 'nocoerp-app' }), grants: JSON.stringify(grants), createdAt: now, updatedAt: now }).execute();
    }
  },
});
