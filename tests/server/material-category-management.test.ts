import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  DEFAULT_ADMIN_CREDENTIALS,
  signIn,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { createStandaloneServer } from '../../server/standalone.js';
import {
  blankMaterial,
  type MaterialCategory,
} from '../../shared/material-master-data.js';

const test = createAppTest({
  createServer: createStandaloneServer,
  connections: ['main'],
  config: {
    logging: { enabled: false },
    app: { publicOrigin: 'http://localhost' },
    auth: { secret: 'isolated-material-category-management-test-secret' },
  },
});
const key = () => `${Date.now()}.${randomUUID()}`;
const mutation = (
  body: unknown,
  method = 'POST',
  operationKey = key(),
): RequestInit => ({
  method,
  headers: {
    'content-type': 'application/json',
    origin: 'http://localhost',
    'Idempotency-Key': operationKey,
  },
  body: JSON.stringify(body),
});
type Session = Awaited<ReturnType<typeof signIn>>;
async function category(
  admin: Session,
  code: string,
  parentId: string | null = null,
): Promise<MaterialCategory> {
  const response = await admin.fetch(
    '/materialMaster/categories',
    mutation({ code, name: code, parentId, description: `${code} note` }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).data;
}
async function saved(admin: Session, id: string): Promise<MaterialCategory> {
  return (
    await (await admin.fetch('/materialMaster/categories')).json()
  ).data.find((row: MaterialCategory) => row.id === id);
}

test('category editing and moves preserve data, detect cycles and versions, and enforce delete references and replay', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const document = await (await admin.fetch('/swagger')).json();
  expect(
    document.paths['/api/materialMaster/categories/{id}/move'].post,
  ).toBeDefined();
  expect(
    document.paths['/api/materialMaster/categories/import/preview'].post,
  ).toBeDefined();
  const root = await category(admin, 'TREE-ROOT');
  const child = await category(admin, 'TREE-CHILD', root.id);
  const leaf = await category(admin, 'TREE-LEAF', child.id);
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${root.id}/move`,
        mutation({
          parentId: leaf.id,
          index: 0,
          expectedVersion: root.version,
        }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${root.id}`,
        mutation({ expectedVersion: root.version }, 'DELETE'),
      )
    ).status,
  ).toBe(409);
  const edited = await admin.fetch(
    `/materialMaster/categories/${child.id}`,
    mutation(
      {
        code: child.code,
        name: 'Renamed child',
        description: 'Retained description',
        expectedVersion: child.version,
      },
      'PATCH',
    ),
  );
  expect(edited.status).toBe(200);
  const updated = (await edited.json()).data;
  expect(updated.version).toBe(child.version + 1);
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${child.id}`,
        mutation(
          {
            code: child.code,
            name: 'Stale',
            description: '',
            expectedVersion: child.version,
          },
          'PATCH',
        ),
      )
    ).status,
  ).toBe(409);
  const moveKey = key();
  const moved = await admin.fetch(
    `/materialMaster/categories/${leaf.id}/move`,
    mutation(
      { parentId: root.id, index: 0, expectedVersion: leaf.version },
      'POST',
      moveKey,
    ),
  );
  expect(moved.status).toBe(200);
  const again = await admin.fetch(
    `/materialMaster/categories/${leaf.id}/move`,
    mutation(
      { parentId: root.id, index: 0, expectedVersion: leaf.version },
      'POST',
      moveKey,
    ),
  );
  expect(again.headers.get('Idempotency-Replayed')).toBe('true');
  expect((await saved(admin, leaf.id)).parentId).toBe(root.id);
  const history = await admin.fetch(
    `/materialMaster/categories/${child.id}/history`,
  );
  expect(
    (await history.json()).data.some(
      (row: { kind: string }) => row.kind === 'updated',
    ),
  ).toBe(true);
  const referenced = await category(admin, 'TREE-REFERENCED');
  expect(
    (
      await admin.fetch(
        '/materialMaster/materials',
        mutation({
          ...blankMaterial,
          code: 'TREE-MATERIAL',
          name: 'Referenced material',
          categoryId: referenced.id,
          unit: 'piece',
        }),
      )
    ).status,
  ).toBe(201);
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${referenced.id}`,
        mutation({ expectedVersion: referenced.version }, 'DELETE'),
      )
    ).status,
  ).toBe(409);
  const empty = await category(admin, 'TREE-EMPTY');
  const deleteKey = key();
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${empty.id}`,
        mutation({ expectedVersion: empty.version }, 'DELETE', deleteKey),
      )
    ).status,
  ).toBe(200);
  const deleteReplay = await admin.fetch(
    `/materialMaster/categories/${empty.id}`,
    mutation({ expectedVersion: empty.version }, 'DELETE', deleteKey),
  );
  expect(deleteReplay.status).toBe(200);
  expect(deleteReplay.headers.get('Idempotency-Replayed')).toBe('true');
});

test('CSV preview is read-only, validates whole trees, imports atomically, and exports safely with round trips', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const csv =
    'code,name,parentCode,description\nCSV-CHILD,Child,CSV-ROOT,"line one\nline two"\nCSV-ROOT,Root,,\n';
  const preview = await admin.fetch(
    '/materialMaster/categories/import/preview',
    mutation({ csv }),
  );
  expect(preview.status).toBe(200);
  const report = (await preview.json()).data;
  expect(report.errors).toEqual([]);
  expect(report.total).toBe(2);
  expect(
    await testApp.connection
      .repository('md_material_categories')
      .exists({ filter: { code: 'CSV-ROOT' } }),
  ).toBe(false);
  const operationKey = key();
  const imported = await admin.fetch(
    '/materialMaster/categories/import',
    mutation({ csv }, 'POST', operationKey),
  );
  expect(imported.status).toBe(200);
  const rows = (await imported.json()).data;
  const parent = rows.find((row: MaterialCategory) => row.code === 'CSV-ROOT');
  expect(
    rows.find((row: MaterialCategory) => row.code === 'CSV-CHILD').parentId,
  ).toBe(parent.id);
  const replay = await admin.fetch(
    '/materialMaster/categories/import',
    mutation({ csv }, 'POST', operationKey),
  );
  expect(replay.headers.get('Idempotency-Replayed')).toBe('true');
  const invalid =
    'code,name,parentCode,description\nCSV-NO-WRITE,Good,,\nCSV-BAD,Bad,MISSING,\n';
  expect(
    (
      await (
        await admin.fetch(
          '/materialMaster/categories/import/preview',
          mutation({ csv: invalid }),
        )
      ).json()
    ).data.errors,
  ).toContainEqual(expect.objectContaining({ line: 3, reason: 'parent' }));
  expect(
    (
      await admin.fetch(
        '/materialMaster/categories/import',
        mutation({ csv: invalid }),
      )
    ).status,
  ).toBe(400);
  expect(
    await testApp.connection
      .repository('md_material_categories')
      .exists({ filter: { code: 'CSV-NO-WRITE' } }),
  ).toBe(false);
  const cycle =
    'code,name,parentCode,description\nCSV-CYCLE-A,A,CSV-CYCLE-B,\nCSV-CYCLE-B,B,CSV-CYCLE-A,\n';
  expect(
    (
      await (
        await admin.fetch(
          '/materialMaster/categories/import/preview',
          mutation({ csv: cycle }),
        )
      ).json()
    ).data.errors.some((error: { reason: string }) => error.reason === 'cycle'),
  ).toBe(true);
  const malformed = await admin.fetch(
    '/materialMaster/categories/import/preview',
    mutation({ csv: 'code,name\n"unterminated,name' }),
  );
  expect((await malformed.json()).data.errors[0].reason).toBe('format');
  const dangerous = await category(admin, '=DANGEROUS');
  const exported = await admin.fetch(
    '/materialMaster/categories/export?q=CSV-CHILD',
  );
  expect(exported.status).toBe(200);
  const text = await exported.text();
  expect(text).toContain('CSV-ROOT');
  expect(text).toContain('CSV-CHILD');
  const formula = await (
    await admin.fetch('/materialMaster/categories/export?q=%3DDANGEROUS')
  ).text();
  expect(formula).toContain("'=DANGEROUS");
  const csvPreview = await admin.fetch(
    '/materialMaster/categories/import/preview',
    mutation({ csv: formula }),
  );
  const decoded = (await csvPreview.json()).data;
  expect(decoded.rows[0].code).toBe(dangerous.code);
  expect(decoded.errors).toContainEqual(
    expect.objectContaining({ reason: 'duplicate' }),
  );
});

test('history and comments are scoped, author-controlled and idempotent, and roles have no automatic recipients', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const item = await category(admin, 'COMMENT-CATEGORY');
  const createKey = key();
  const response = await admin.fetch(
    `/materialMaster/categories/${item.id}/comments`,
    mutation({ body: '<script>alert(1)</script>' }, 'POST', createKey),
  );
  expect(response.status).toBe(200);
  const comment = (await response.json()).data;
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${item.id}/comments`,
        mutation({ body: '<script>alert(1)</script>' }, 'POST', createKey),
      )
    ).headers.get('Idempotency-Replayed'),
  ).toBe('true');
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${item.id}/comments`,
        mutation({ body: 'Reply text', replyToId: comment.id }),
      )
    ).status,
  ).toBe(200);
  const edited = await admin.fetch(
    `/materialMaster/categories/${item.id}/comments/${comment.id}`,
    mutation(
      { body: 'Edited text', expectedVersion: comment.version },
      'PATCH',
    ),
  );
  expect(edited.status).toBe(200);
  const updated = (await edited.json()).data;
  const account = {
    username: 'categorywriter',
    name: 'Category writer',
    email: 'category-writer@example.test',
    password: 'Isolated-category-writer-123!',
    roleScopes: { app: ['material-category-manager'] },
  };
  expect((await admin.fetch('/users', mutation(account))).status).toBe(201);
  const other = await signIn(testApp, account);
  expect(
    (
      await other.fetch(
        `/materialMaster/categories/${item.id}/comments/${comment.id}`,
        mutation({ expectedVersion: updated.version }, 'DELETE'),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${item.id}/comments/${comment.id}`,
        mutation({ expectedVersion: updated.version }, 'DELETE'),
      )
    ).status,
  ).toBe(200);
  const comments = (
    await (
      await admin.fetch(
        `/materialMaster/categories/${item.id}/history?filter=comments`,
      )
    ).json()
  ).data;
  expect(comments).toHaveLength(2);
  expect(
    comments.find((row: { id: string }) => row.id === comment.id).deletedAt,
  ).toBeTruthy();
  const otherCategory = await category(admin, 'COMMENT-OTHER');
  expect(
    (
      await admin.fetch(
        `/materialMaster/categories/${otherCategory.id}/comments`,
        mutation({ body: 'Wrong thread', replyToId: comment.id }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await testApp.request(`/materialMaster/categories/${item.id}/history`))
      .status,
  ).toBe(401);
  const authz = testApp.application.container.resolve(authorizationToken);
  expect(
    await authz.permissionSets.listAssignments('material-category-viewer'),
  ).toEqual([]);
  // Only the explicit synthetic account above holds this role; no global default was added.
  expect(
    (
      await authz.permissionSets.listAssignments('material-category-manager')
    ).every((assignment) => assignment.subject.type === 'user'),
  ).toBe(true);
});

test('new actions respect record scopes, deny hidden affected siblings and keep related materials independent', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const root = await category(admin, 'SCOPED-ROOT');
  const a = await category(admin, 'SCOPED-A', root.id);
  const b = await category(admin, 'SCOPED-B', root.id);
  const hidden = await category(admin, 'SCOPED-HIDDEN');
  const scope = {
    type: 'composite',
    scopes: { categories: { type: 'records', ids: [root.id, a.id] } },
  };
  expect(
    (
      await admin.fetch(
        '/authorization/permissionSets',
        mutation({
          key: 'category-scoped',
          grants: [
            {
              resource: { type: 'page', id: 'materials.categories' },
              actions: [{ action: 'access' }],
            },
            {
              resource: { type: 'composite', id: 'masterData.categories' },
              actions: [
                'view',
                'edit',
                'move',
                'delete',
                'import',
                'export',
                'comment',
              ].map((action) => ({ action, policy: scope })),
            },
          ],
        }),
      )
    ).status,
  ).toBe(201);
  const account = {
    username: 'scopedcategory',
    name: 'Scoped category user',
    email: 'scoped-category@example.test',
    password: 'Isolated-scoped-category-123!',
    roleScopes: { app: ['category-scoped'] },
  };
  expect((await admin.fetch('/users', mutation(account))).status).toBe(201);
  const scoped = await signIn(testApp, account);
  expect(
    (await scoped.fetch(`/materialMaster/categories/${hidden.id}/history`))
      .status,
  ).toBe(404);
  expect(
    (
      await scoped.fetch(
        `/materialMaster/categories/${hidden.id}/comments`,
        mutation({ body: 'forbidden' }),
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await scoped.fetch(
        `/materialMaster/categories/${a.id}/move`,
        mutation({ parentId: hidden.id, index: 0, expectedVersion: a.version }),
      )
    ).status,
  ).toBe(404);
  // Removing A from its current siblings would renumber hidden B. This must be atomic and denied.
  expect(
    (
      await scoped.fetch(
        `/materialMaster/categories/${a.id}/move`,
        mutation({ parentId: null, index: 0, expectedVersion: a.version }),
      )
    ).status,
  ).toBe(403);
  expect((await saved(admin, a.id)).parentId).toBe(root.id);
  expect((await saved(admin, b.id)).sortOrder).toBe(1);
  const csv = `code,name,parentCode,description\nSCOPED-NEW,New,${hidden.code},\n`;
  const preview = await scoped.fetch(
    '/materialMaster/categories/import/preview',
    mutation({ csv }),
  );
  expect((await preview.json()).data.errors).toContainEqual(
    expect.objectContaining({ reason: 'parent' }),
  );
  expect(
    (await scoped.fetch('/materialMaster/categories/import', mutation({ csv })))
      .status,
  ).toBe(400);
  const exported = await (
    await scoped.fetch('/materialMaster/categories/export')
  ).text();
  expect(exported).toContain(a.code);
  expect(exported).not.toContain(hidden.code);
  expect(exported).not.toContain(b.code);
  expect((await scoped.fetch('/materialMaster/materials')).status).toBe(403);
  expect(
    (await scoped.fetch(`/materialMaster/categories/${a.id}/history`)).status,
  ).toBe(200);
  // Revoking the explicit role rejects all new operation endpoints, even if a URL is known.
  const user = (await (await admin.fetch('/users')).json()).data.find(
    (row: { username: string }) => row.username === account.username,
  );
  expect(
    (
      await admin.fetch(
        `/users/${user.id}/roleScopes/app`,
        mutation({ value: ['member'] }, 'PUT'),
      )
    ).status,
  ).toBe(200);
  for (const [path, init] of [
    [`/${a.id}/history`, undefined],
    ['/export', undefined],
    ['/import/preview', mutation({ csv })],
    ['/import', mutation({ csv })],
    [`/${a.id}/comments`, mutation({ body: 'Denied' })],
    [
      `/${a.id}/move`,
      mutation({ parentId: null, index: 0, expectedVersion: a.version }),
    ],
    [
      `/${a.id}`,
      mutation(
        {
          code: a.code,
          name: 'Denied',
          description: '',
          expectedVersion: a.version,
        },
        'PATCH',
      ),
    ],
    [`/${a.id}`, mutation({ expectedVersion: a.version }, 'DELETE')],
  ] as const)
    expect(
      (await scoped.fetch(`/materialMaster/categories${path}`, init)).status,
    ).toBe(403);
});

test('concurrent opposing moves cannot create a cycle', async ({ testApp }) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const a = await category(admin, 'CONCURRENT-A');
  const b = await category(admin, 'CONCURRENT-B');
  const responses = await Promise.all([
    admin.fetch(
      `/materialMaster/categories/${a.id}/move`,
      mutation({ parentId: b.id, index: 0, expectedVersion: a.version }),
    ),
    admin.fetch(
      `/materialMaster/categories/${b.id}/move`,
      mutation({ parentId: a.id, index: 0, expectedVersion: b.version }),
    ),
  ]);
  expect(responses.filter((response) => response.status === 200)).toHaveLength(
    1,
  );
  expect(
    responses.some((response) => [400, 409].includes(response.status)),
  ).toBe(true);
  const nodes = [await saved(admin, a.id), await saved(admin, b.id)];
  expect(nodes.every((node) => node.parentId !== null)).toBe(false);
});
