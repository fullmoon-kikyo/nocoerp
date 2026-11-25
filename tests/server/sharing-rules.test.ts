import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { selection } from '@nocobase/authorization/core';
import { createStandaloneServer } from '../../server/standalone.js';
import { registerSharingFixture } from '../helpers/sharing-fixture.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    logging: { enabled: false },
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'isolated-sharing-management-test-secret' },
  },
});
const mutation = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

test('sharing management APIs are protected and a reader cannot create, update or revoke', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const specification = await (await admin.fetch('/swagger')).json();
  for (const path of [
    '/api/authorization/sharingRules',
    '/api/authorization/sharingRules/options',
    '/api/authorization/sharingRules/subjects/{type}',
    '/api/authorization/sharingRules/records/{collection}',
  ])
    expect(specification.paths[path]).toBeDefined();
  const account = {
    name: 'Sharing learner',
    username: `sharing_${randomUUID().slice(0, 8)}`,
    password: 'Sharing-isolated-123!',
    email: `${randomUUID()}@example.test`,
  };
  const created = await admin.fetch('/users', mutation(account));
  expect(created.status).toBe(201);
  const user = (await created.json()).data;
  const ordinary = await signIn(testApp, account);
  const reads = [
    '/authorization/sharingRules',
    '/authorization/sharingRules/options',
    '/authorization/sharingRules/subjects/user',
    '/authorization/sharingRules/records/sharingItems',
  ];
  for (const path of reads)
    expect((await ordinary.fetch(path)).status).toBe(403);
  for (const [path, method, body] of [
    ['/authorization/sharingRules', 'POST', {}],
    ['/authorization/sharingRules/unknown', 'PATCH', {}],
    ['/authorization/sharingRules/unknown', 'DELETE', undefined],
    [
      '/authorization/sharingRules/subjects/user/resolve',
      'POST',
      { ids: [user.id] },
    ],
  ] as const)
    expect((await ordinary.fetch(path, mutation(body, method))).status).toBe(
      403,
    );
  expect((await testApp.request('/authorization/sharingRules')).status).toBe(
    401,
  );
  const role = await admin.fetch(
    '/authorization/permissionSets',
    mutation({
      key: 'sharing-reader',
      title: 'Sharing reader',
      grants: [
        {
          resource: { type: 'settings', id: 'authorization.sharing-rules' },
          actions: [{ action: 'read' }],
        },
      ],
    }),
  );
  expect(role.status).toBe(201);
  expect(
    (
      await admin.fetch(
        `/users/${user.id}/roleScopes/app`,
        mutation({ value: ['member', 'sharing-reader'] }, 'PUT'),
      )
    ).status,
  ).toBe(200);
  const reader = await signIn(testApp, account);
  for (const path of reads.slice(0, 2)) {
    const response = await reader.fetch(path);
    expect(response.status, `${path}: ${await response.text()}`).toBe(200);
  }
  // The user directory additionally enforces user-management read permission.
  expect(
    (await reader.fetch('/authorization/sharingRules/subjects/user')).status,
  ).toBe(403);
  for (const method of ['POST', 'PATCH', 'DELETE'])
    expect(
      (
        await ordinary.fetch(
          `/authorization/sharingRules${method === 'POST' ? '' : '/unknown'}`,
          mutation(method === 'DELETE' ? undefined : {}, method),
        )
      ).status,
    ).toBe(403);
});

test('sharing preserves other rules, requires an action, respects restrictions and related scopes, and revocation preserves independent grants', async ({
  testApp,
}) => {
  const { authz, resource } = await registerSharingFixture(testApp);
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const account = {
    name: 'Policy recipient',
    username: 'policyrecipient',
    email: 'policy-recipient@example.test',
    password: 'Policy-recipient-isolated-123!',
  };
  const createdUser = await admin.fetch('/users', mutation(account));
  expect(createdUser.status).toBe(201);
  const subject = { type: 'user', id: (await createdUser.json()).data.id };
  const ordinary = await signIn(testApp, account);
  expect((await ordinary.fetch('/authorization/sharingRules')).status).toBe(
    403,
  );
  const context = () => authz.for({ principal: subject, subjects: [] });
  const input = {
    key: 'handover',
    title: 'Explicit handover',
    resource: { type: 'composite', id: resource.name },
    subjects: [subject],
    actions: [
      {
        action: 'view',
        scopeKey: 'items',
        selection: selection.records(['delegated', 'confidential']),
      },
      {
        action: 'submit',
        scopeKey: 'items',
        selection: selection.records(['delegated']),
      },
    ],
  };
  const create = await admin.fetch(
    '/authorization/sharingRules',
    mutation(input),
  );
  expect(create.status).toBe(201);
  expect(
    (
      await context().authorize({
        resource: { type: 'composite', id: resource.name },
        action: 'view',
      })
    ).effect,
  ).toBe('deny');
  await authz.permissionSets.create({
    key: 'sharing-operator',
    grants: [
      resource.grant({
        view: { items: selection.records(['baseline']) },
        submit: { items: '', parents: '' },
      }),
    ],
  });
  await authz.permissionSets.assign({
    permissionSet: 'sharing-operator',
    subject,
  });
  async function rows(action = 'view', collection = 'sharingItems') {
    const decision = await context().authorize({
      resource: { type: 'composite', id: resource.name },
      action,
    });
    if (decision.effect === 'deny') return [];
    const policy = await authz.database.policyFor(collection, context(), {
      resource: resource.name,
      action,
    });
    if (!policy.read) return [];
    return testApp.connection
      .repository(collection)
      .withPolicy(policy)
      .findMany();
  }
  expect((await rows()).map((row) => row.id).sort()).toEqual([
    'baseline',
    'confidential',
    'delegated',
  ]);
  expect((await rows()).every((row) => !('secret' in row))).toBe(true);
  expect(await rows('submit', 'sharingParents')).toEqual([]);
  const parentPolicy = await authz.database.policyFor(
    'sharingParents',
    context(),
    { resource: resource.name, action: 'submit' },
  );
  await expect(
    testApp.connection
      .repository('sharingParents')
      .withPolicy(parentPolicy)
      .findMany(),
  ).rejects.toThrow('forbidden by Policy');
  expect(
    (
      await context().authorize({
        resource: { type: 'composite', id: resource.name },
        action: 'edit',
      })
    ).effect,
  ).toBe('deny');
  expect(
    (
      await context().authorize({
        resource: { type: 'page', id: 'sharing-fixture-page' },
        action: 'access',
      })
    ).effect,
  ).toBe('deny');
  const inspection = await admin.fetch(
    '/authorization/inspector/decide',
    mutation({
      subject,
      resource: { type: 'composite', id: resource.name },
      action: 'view',
    }),
  );
  expect(inspection.status).toBe(200);
  expect((await inspection.json()).data.effect).not.toBe('deny');
  const restriction = {
    key: 'confidentiality',
    resource: { type: 'composite', id: resource.name },
    subjects: [subject],
    actions: [
      {
        action: 'view',
        scopeKey: 'items',
        selection: selection.records(['baseline', 'delegated', 'independent']),
      },
    ],
  };
  expect(
    (
      await admin.fetch(
        '/authorization/restrictionRules',
        mutation(restriction),
      )
    ).status,
  ).toBe(201);
  expect((await rows()).map((row) => row.id).sort()).toEqual([
    'baseline',
    'delegated',
  ]);
  const independent = {
    key: 'independent-sharing',
    resource: { type: 'composite', id: resource.name },
    subjects: [subject],
    actions: [
      {
        action: 'view',
        scopeKey: 'items',
        selection: selection.records(['independent', 'delegated']),
      },
    ],
  };
  expect(
    (await admin.fetch('/authorization/sharingRules', mutation(independent)))
      .status,
  ).toBe(201);
  const patched = await admin.fetch(
    '/authorization/sharingRules/handover',
    mutation(
      {
        title: 'Reviewed handover',
        subjects: [subject],
        actions: [
          ...input.actions,
          {
            action: 'submit',
            scopeKey: 'parents',
            selection: selection.records(['parent-1']),
          },
        ],
      },
      'PATCH',
    ),
  );
  expect(patched.status).toBe(200);
  expect((await rows('submit', 'sharingParents')).map((row) => row.id)).toEqual(
    ['parent-1'],
  );
  expect((await rows('submit')).map((row) => row.id)).toEqual(['delegated']);
  expect(
    (
      await admin.fetch(
        '/authorization/sharingRules/handover',
        mutation(undefined, 'DELETE'),
      )
    ).status,
  ).toBe(204);
  expect((await rows()).map((row) => row.id).sort()).toEqual([
    'baseline',
    'delegated',
    'independent',
  ]);
  const remaining = (
    await (await admin.fetch('/authorization/sharingRules')).json()
  ).data;
  expect(remaining).toEqual([expect.objectContaining(independent)]);
  expect(await rows('submit')).toEqual([]);
  // Removing the action grant also disables the surviving sharing source.
  const assignments =
    await authz.permissionSets.listAssignments('sharing-operator');
  await authz.permissionSets.revoke(assignments[0]!.id);
  expect(
    (
      await context().authorize({
        resource: { type: 'composite', id: resource.name },
        action: 'view',
      })
    ).effect,
  ).toBe('deny');
});
