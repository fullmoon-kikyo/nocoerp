import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';
import { blankMaterial } from '../../shared/material-master-data.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    logging: { enabled: false },
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'isolated-material-master-data-test-secret' },
  },
});
const mutation = (
  body: unknown,
  method = 'POST',
  key = `${Date.now()}.${randomUUID()}`,
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': key,
  },
  body: JSON.stringify(body),
});

test('creates hierarchical categories and materials, filters descendants, rejects duplicate codes, replays safely and detects stale edits', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const document = await (await admin.fetch('/swagger')).json();
  expect(document.paths['/api/materialMaster/materials'].post).toBeDefined();
  expect(document.paths['/api/materialMaster/categories'].post).toBeDefined();
  const category = await admin.fetch(
    '/materialMaster/categories',
    mutation({ code: 'RAW', name: 'Raw materials', parentId: null }),
  );
  expect(category.status).toBe(201);
  const root = (await category.json()).data;
  const childResponse = await admin.fetch(
    '/materialMaster/categories',
    mutation({ code: 'STEEL', name: 'Steel', parentId: root.id }),
  );
  expect(childResponse.status).toBe(201);
  const child = (await childResponse.json()).data;
  const input = {
    ...blankMaterial,
    code: 'MAT-001',
    name: 'Die steel',
    unit: 'kg',
    categoryId: child.id,
    materialGrade: 'H13',
  };
  const key = `${Date.now()}.${randomUUID()}`;
  const created = await admin.fetch(
    '/materialMaster/materials',
    mutation(input, 'POST', key),
  );
  expect(created.status).toBe(201);
  const material = (await created.json()).data;
  expect(material.version).toBe(1);
  expect(material.createdById).toBeTruthy();
  const replayed = await admin.fetch(
    '/materialMaster/materials',
    mutation(input, 'POST', key),
  );
  expect(replayed.status).toBe(201);
  expect(replayed.headers.get('Idempotency-Replayed')).toBe('true');
  expect((await replayed.json()).data.id).toBe(material.id);
  expect(
    (await admin.fetch('/materialMaster/materials', mutation(input))).status,
  ).toBe(409);
  const filtered = await admin.fetch(
    `/materialMaster/materials?categoryId=${root.id}&q=steel`,
  );
  expect(filtered.status).toBe(200);
  expect(
    (await filtered.json()).data.map((row: { id: string }) => row.id),
  ).toEqual([material.id]);
  const edit = await admin.fetch(
    `/materialMaster/materials/${material.id}`,
    mutation({ ...input, name: 'Updated steel', expectedVersion: 1 }, 'PATCH'),
  );
  expect(edit.status).toBe(200);
  expect((await edit.json()).data.version).toBe(2);
  const stale = await admin.fetch(
    `/materialMaster/materials/${material.id}`,
    mutation({ ...input, expectedVersion: 1 }, 'PATCH'),
  );
  expect(stale.status).toBe(409);
  expect(
    (
      await (
        await admin.fetch(`/materialMaster/materials/${material.id}`)
      ).json()
    ).data.name,
  ).toBe('Updated steel');
  expect(
    (
      await admin.fetch(
        '/materialMaster/materials',
        mutation({ ...input, code: 'BAD', createdById: 'forged' }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.fetch(
        '/materialMaster/materials',
        mutation({ ...input, code: 'MISSING', categoryId: randomUUID() }),
      )
    ).status,
  ).toBe(404);
});

test('roles stay unassigned, ordinary users are denied, viewers cannot write and managers can use only their scopes', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  for (const role of ['material-manager', 'material-viewer']) {
    const roleResponse = await admin.fetch(
      `/authorization/permissionSets/${role}`,
    );
    expect(roleResponse.status).toBe(200);
    const assignments = await testApp.application.container
      .resolve(authorizationToken)
      .permissionSets.listAssignments(role);
    expect(assignments).toEqual([]);
  }
  const credentials = {
    username: `material_${randomUUID().slice(0, 8)}`,
    name: 'Material learner',
    email: `${randomUUID()}@example.test`,
    password: 'Isolated-material-learner-123!',
  };
  const account = await admin.fetch('/users', mutation(credentials));
  expect(account.status).toBe(201);
  const user = (await account.json()).data;
  const ordinary = await signIn(testApp, credentials);
  expect((await ordinary.fetch('/materialMaster/materials')).status).toBe(403);
  expect((await ordinary.fetch('/materialMaster/categories')).status).toBe(403);
  expect((await testApp.request('/materialMaster/materials')).status).toBe(401);
  await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member', 'material-viewer'] }, 'PUT'),
  );
  expect((await ordinary.fetch('/materialMaster/materials')).status).toBe(200);
  expect(
    (
      await ordinary.fetch(
        '/materialMaster/categories',
        mutation({ code: 'NO', name: 'Forbidden', parentId: null }),
      )
    ).status,
  ).toBe(403);
  await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member', 'material-manager'] }, 'PUT'),
  );
  const response = await ordinary.fetch(
    '/materialMaster/categories',
    mutation({ code: 'MANAGER', name: 'Manager category', parentId: null }),
  );
  expect(response.status).toBe(201);
  const category = (await response.json()).data;
  const input = {
    ...blankMaterial,
    code: 'MANAGER-MAT',
    name: 'Manager material',
    categoryId: category.id,
    unit: 'piece',
  };
  const material = await ordinary.fetch(
    '/materialMaster/materials',
    mutation(input),
  );
  expect(material.status).toBe(201);
  await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member'] }, 'PUT'),
  );
  expect((await ordinary.fetch('/materialMaster/materials')).status).toBe(403);
});

test('record scopes and category targets hold on direct requests; page access alone grants no data operation', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const categories = [];
  const materials = [];
  for (const code of ['SCOPE-A', 'SCOPE-B']) {
    const category = (
      await (
        await admin.fetch(
          '/materialMaster/categories',
          mutation({ code, name: code, parentId: null }),
        )
      ).json()
    ).data;
    categories.push(category);
    const material = (
      await (
        await admin.fetch(
          '/materialMaster/materials',
          mutation({
            ...blankMaterial,
            code,
            name: code,
            unit: 'kg',
            categoryId: category.id,
          }),
        )
      ).json()
    ).data;
    materials.push(material);
  }
  const selection = (id: string) => ({ type: 'records', ids: [id] });
  const categorySelection = selection(categories[0].id);
  const materialSelection = selection(materials[0].id);
  const role = {
    key: 'material-scoped',
    grants: [
      {
        resource: { type: 'page', id: 'materials.master-data' },
        actions: [{ action: 'access' }],
      },
      {
        resource: { type: 'composite', id: 'masterData.categories' },
        actions: [
          {
            action: 'view',
            policy: {
              type: 'composite',
              scopes: { categories: categorySelection },
            },
          },
        ],
      },
      {
        resource: { type: 'composite', id: 'masterData.materials' },
        actions: ['view', 'edit'].map((action) => ({
          action,
          policy: {
            type: 'composite',
            scopes:
              action === 'view'
                ? { materials: materialSelection }
                : {
                    materials: materialSelection,
                    categories: categorySelection,
                  },
          },
        })),
      },
    ],
  };
  expect(
    (await admin.fetch('/authorization/permissionSets', mutation(role))).status,
  ).toBe(201);
  const credentials = {
    username: 'scopedmaterial',
    name: 'Scoped material user',
    email: 'scoped-material@example.test',
    password: 'Isolated-scoped-material-123!',
    roleScopes: { app: [role.key] },
  };
  const created = await admin.fetch('/users', mutation(credentials));
  expect(created.status).toBe(201);
  const user = (await created.json()).data;
  const scoped = await signIn(testApp, credentials);
  const list = await scoped.fetch('/materialMaster/materials');
  expect((await list.json()).data.map((row: { id: string }) => row.id)).toEqual(
    [materials[0].id],
  );
  expect(
    (await scoped.fetch(`/materialMaster/materials/${materials[1].id}`)).status,
  ).toBe(404);
  const input = {
    ...blankMaterial,
    code: 'SCOPE-A',
    name: 'Changed',
    categoryId: categories[0].id,
    unit: 'kg',
    expectedVersion: 1,
  };
  expect(
    (
      await scoped.fetch(
        `/materialMaster/materials/${materials[1].id}`,
        mutation(input, 'PATCH'),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await scoped.fetch(
        `/materialMaster/materials/${materials[0].id}`,
        mutation({ ...input, categoryId: categories[1].id }, 'PATCH'),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await scoped.fetch(
        `/materialMaster/materials?categoryId=${categories[1].id}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await scoped.fetch(
        `/materialMaster/materials/${materials[0].id}`,
        mutation(input, 'PATCH'),
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await admin.fetch(
        '/authorization/permissionSets',
        mutation({ key: 'material-page-only', grants: [role.grants[0]] }),
      )
    ).status,
  ).toBe(201);
  await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member', 'material-page-only'] }, 'PUT'),
  );
  expect((await scoped.fetch('/materialMaster/materials')).status).toBe(403);
});
