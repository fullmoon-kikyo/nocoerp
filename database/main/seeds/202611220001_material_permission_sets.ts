import { defineSeed } from '@nocobase/db';
import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';

const page = { resource: { type: 'page', id: 'materials.master-data' }, actions: [{ action: 'access' }] };
const categoryGrant = (write: boolean) => ({ resource: { type: 'composite', id: 'masterData.categories' }, actions: (write ? ['view', 'create'] : ['view']).map((action) => ({ action, policy: { type: 'composite', scopes: { categories: 'allRecords' } } })) });
const materialGrant = (write: boolean) => ({ resource: { type: 'composite', id: 'masterData.materials' }, actions: (write ? ['view', 'create', 'edit'] : ['view']).map((action) => ({ action, policy: { type: 'composite', scopes: action === 'view' ? { materials: 'allRecords' } : { materials: 'allRecords', categories: 'allRecords' } } })) });
const materialPermissionSets = [
  definePermissionSet('material-manager').title({ key: 'materials.managerRole', ns: 'nocoerp-app' }).grant(page, categoryGrant(true), materialGrant(true)).build(),
  definePermissionSet('material-viewer').title({ key: 'materials.viewerRole', ns: 'nocoerp-app' }).grant(page, categoryGrant(false), materialGrant(false)).build(),
];

/** Editable job definitions only: no wildcard assignment and no change to existing roles. */
export default defineSeed({
  name: '202611220001_material_permission_sets',
  async run({ query }) {
    for (const role of materialPermissionSets) {
      const existing = await query.selectFrom('authorizationPermissionSets').select('id').where('key', '=', role.key).executeTakeFirst();
      if (existing) continue;
      const now = new Date();
      await query.insertInto('authorizationPermissionSets').values({ id: role.key, key: role.key, title: encodeAuthorizationTitle(role.title), grants: JSON.stringify(role.grants), createdAt: now, updatedAt: now }).execute();
    }
  },
});
