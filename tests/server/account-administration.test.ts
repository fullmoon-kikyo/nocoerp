import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'isolated-account-administration-test-secret' },
  },
});

function mutation(body: unknown, method = 'POST'): RequestInit {
  return {
    method,
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
      'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
    },
    body: JSON.stringify(body),
  };
}

const newAccount = () => {
  const username = `learner_${randomUUID().slice(0, 8)}`;
  return {
    name: 'ERP learner',
    username,
    email: `${username}@example.test`,
    password: 'Isolated-learner-test-123!',
  };
};

test('an administrator creates a user and role, assigns it, and reads the saved assignment', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const document = await admin.fetch('/swagger');
  expect(document.status).toBe(200);
  const specification = await document.json();
  expect(specification.paths['/api/users'].post).toBeDefined();
  expect(
    specification.paths['/api/authorization/permissionSets'].post,
  ).toBeDefined();

  const role = {
    key: `learner-${randomUUID()}`,
    title: 'ERP learner',
    grants: [],
  };
  const createdRole = await admin.fetch(
    '/authorization/permissionSets',
    mutation(role),
  );
  expect(createdRole.status).toBe(201);
  const account = newAccount();
  const createdUser = await admin.fetch('/users', mutation(account));
  expect(createdUser.status).toBe(201);
  const user = (await createdUser.json()).data;

  const assigned = await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member', role.key] }, 'PUT'),
  );
  expect(assigned.status).toBe(200);
  const saved = await admin.fetch(`/users/${user.id}`);
  expect((await saved.json()).data.roleScopes.app.sort()).toEqual(
    ['member', role.key].sort(),
  );

  // Assigning a named role with no management grants cannot make its holder an administrator.
  const ordinary = await signIn(testApp, account);
  for (const path of [
    '/users',
    '/users/options',
    '/authorization/permissionSets',
    '/authorization/defaultAccess',
  ])
    expect((await ordinary.fetch(path)).status).toBe(403);
  expect((await ordinary.fetch('/users/me/preferences')).status).toBe(200);
});

test('an ordinary account cannot create accounts, edit assignments or create roles', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const account = newAccount();
  const response = await admin.fetch('/users', mutation(account));
  expect(response.status).toBe(201);
  const user = (await response.json()).data;
  const ordinary = await signIn(testApp, account);

  expect((await ordinary.fetch('/users', mutation(newAccount()))).status).toBe(
    403,
  );
  expect(
    (
      await ordinary.fetch(
        `/users/${user.id}/roleScopes/app`,
        mutation({ value: ['root'] }, 'PUT'),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await ordinary.fetch(
        '/authorization/permissionSets',
        mutation({ key: `forbidden-${randomUUID()}`, grants: [] }),
      )
    ).status,
  ).toBe(403);
  const saved = await admin.fetch(`/users/${user.id}`);
  expect((await saved.json()).data.roleScopes.app).toEqual(['member']);
});

test('read access opens user data without granting creation or role assignment, and revocation takes effect', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const roleKey = `reader-${randomUUID()}`;
  const createdRole = await admin.fetch(
    '/authorization/permissionSets',
    mutation({
      key: roleKey,
      grants: [
        { resource: { type: 'user', id: '*' }, actions: [{ action: 'read' }] },
      ],
    }),
  );
  expect(createdRole.status).toBe(201);
  const account = newAccount();
  const createdUser = await admin.fetch(
    '/users',
    mutation({ ...account, roleScopes: { app: [roleKey] } }),
  );
  expect(createdUser.status).toBe(201);
  const user = (await createdUser.json()).data;
  const reader = await signIn(testApp, account);
  expect((await reader.fetch('/users')).status).toBe(200);
  expect((await reader.fetch('/users', mutation(newAccount()))).status).toBe(
    403,
  );
  expect(
    (
      await reader.fetch(
        `/users/${user.id}/roleScopes/app`,
        mutation({ value: ['root'] }, 'PUT'),
      )
    ).status,
  ).toBe(403);
  expect((await reader.fetch('/authorization/permissionSets')).status).toBe(
    403,
  );

  const revoked = await admin.fetch(
    `/users/${user.id}/roleScopes/app`,
    mutation({ value: ['member'] }, 'PUT'),
  );
  expect(revoked.status).toBe(200);
  expect((await reader.fetch('/users')).status).toBe(403);
});

test('management APIs reject anonymous requests', async ({ testApp }) => {
  for (const path of [
    '/users',
    '/users/options',
    '/authorization/permissionSets',
    '/authorization/defaultAccess',
  ])
    expect((await testApp.request(path)).status).toBe(401);
});
