import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createTestApp, type TestApp } from '@nocobase/app-testing/server';
import { signIn } from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';

const applicationUrl = process.env.APP_URL;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
base.use({
  ...(executablePath ? { launchOptions: { executablePath } } : {}),
});

type AcceptanceApp = {
  server: TestApp;
  credentials: { username: string; password: string };
  connect(context: BrowserContext): Promise<void>;
};

const test = base.extend<{ acceptance: AcceptanceApp }>({
  acceptance: async ({ context }, provide) => {
    await context.clearCookies();
    const origin = new URL(applicationUrl!).origin;
    const appPath = new URL(applicationUrl!).pathname.replace(/\/$/, '');
    const credentials = {
      username: 'acceptanceadmin',
      password: `Acceptance-${randomUUID()}!`,
    };
    const server = await createTestApp({
      createServer: createStandaloneServer,
      connections: ['main'],
      server: {
        env: { APP_PUBLIC_ORIGIN: origin, BETTER_AUTH_TRUSTED_ORIGINS: origin },
      },
      config: {
        logging: { enabled: false },
        app: { publicOrigin: origin },
        auth: { secret: 'isolated-browser-account-administration-test-secret' },
        users: {
          initialAdmin: {
            ...credentials,
            email: 'acceptance-admin@example.test',
          },
        },
      },
    });
    try {
      await provide({
        server,
        credentials,
        async connect(context) {
          // Exercise the running frontend against real isolated plugins, sessions and database.
          // Management API requests stay in the isolated application's database.
          await context.route(`${origin}${appPath}/api/**`, async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const suffix = url.pathname.slice(appPath.length);
            const response = await server.fetch(
              new Request(
                `${origin}${server.publicBasePath.replace(/\/$/, '')}${suffix}${url.search}`,
                {
                  method: request.method(),
                  headers: await request.allHeaders(),
                  ...(request.postData() !== null
                    ? { body: request.postData()! }
                    : {}),
                },
              ),
            );
            const headers = Object.fromEntries(response.headers);
            const cookies = response.headers.getSetCookie();
            if (cookies.length) headers['set-cookie'] = cookies.join('\n');
            await route.fulfill({
              status: response.status,
              headers,
              body: Buffer.from(await response.arrayBuffer()),
            });
          });
        },
      });
    } finally {
      await server.close();
    }
  },
});

test.skip(!applicationUrl, 'Set APP_URL to the running application entry.');

async function logIn(page: Page, credentials: AcceptanceApp['credentials']) {
  await page.goto(`${applicationUrl!.replace(/\/$/, '')}/login`);
  await page.locator('input[name="identifier"]').fill(credentials.username);
  await page.locator('input[type="password"]').fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  await expect(
    page.getByRole('navigation', {
      name: 'Application navigation',
      exact: true,
    }),
  ).toBeVisible();
}

const mutation = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    origin: new URL(applicationUrl!).origin,
    'Idempotency-Key': `${Date.now()}.${randomUUID()}`,
  },
  body: JSON.stringify(body),
});

test('administrator manages accounts and roles through System settings; ordinary users are denied', async ({
  page,
  context,
  browser,
  acceptance,
}, testInfo) => {
  const root = applicationUrl!.replace(/\/$/, '');
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  await page
    .getByRole('link', { name: 'System settings', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Accounts and permissions' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Users\s*Manage accounts/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /^Permission management\s*Set what/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('system-settings.png'),
    fullPage: true,
  });

  await page
    .getByRole('link', { name: /^Permission management\s*Set what/ })
    .click();
  await page.getByRole('button', { name: 'New role', exact: true }).click();
  const roleKey = `acceptance-${randomUUID().slice(0, 8)}`;
  const roleTitle = 'Acceptance learner';
  await page.locator('#role-key').fill(roleKey);
  await page.locator('#role-name').fill(roleTitle);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp('/settings/roles(?:\\?.*)?$'));
  await expect(
    page.getByRole('link', { name: roleTitle, exact: true }),
  ).toBeVisible();

  await page.goto(`${root}/settings/users`);
  await page.getByRole('button', { name: 'New user', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New user', exact: true });
  const username = `learner_${randomUUID().slice(0, 8)}`;
  const password = `Acceptance-${randomUUID()}!`;
  await form.locator('input[name="name"]').fill('Acceptance employee');
  await form.locator('input[name="username"]').fill(username);
  await form.locator('input[name="email"]').fill(`${username}@example.test`);
  await form.locator('input[name="password"]').fill(password);
  await form.getByRole('combobox').click();
  await page.getByRole('option', { name: roleTitle, exact: true }).click();
  await form.locator('input[name="name"]').click();
  await form.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(form).not.toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Acceptance employee', exact: true }),
  ).toBeVisible();

  const admin = await signIn(acceptance.server, acceptance.credentials);
  const listed = await admin.fetch(`/users?q=${username}`);
  const account = (await listed.json()).data.find(
    (user: { username: string }) => user.username === username,
  );
  expect(account.roleScopes.app).toContain(roleKey);
  const storedRole = await admin.fetch(
    `/authorization/permissionSets/${roleKey}`,
  );
  expect((await storedRole.json()).data.grants).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('users-and-role-assignment.png'),
    fullPage: true,
  });

  const ordinaryContext = await browser.newContext();
  try {
    await acceptance.connect(ordinaryContext);
    const ordinary = await ordinaryContext.newPage();
    await logIn(ordinary, { username, password });
    await expect(
      ordinary.getByRole('link', { name: 'System settings', exact: true }),
    ).toHaveCount(0);
    for (const path of ['users', 'roles', 'default-access']) {
      await ordinary.goto(`${root}/settings/${path}`);
      await expect(
        ordinary.getByText('Access denied', { exact: true }),
      ).toBeVisible();
    }
    const statuses = await ordinary.evaluate(
      async ({ root, userId, operationKey }) => {
        const results: Record<string, number> = {};
        for (const path of [
          'users',
          'users/options',
          'authorization/permissionSets',
          'authorization/defaultAccess',
        ])
          results[`GET ${path}`] = (await fetch(`${root}/api/${path}`)).status;
        for (const [path, method, body] of [
          [
            'users',
            'POST',
            {
              name: 'Forbidden',
              email: 'forbidden@example.test',
              password: 'Test-only-123!',
            },
          ],
          [
            'authorization/permissionSets',
            'POST',
            { key: 'forbidden', grants: [] },
          ],
          [`users/${userId}/roleScopes/app`, 'PUT', { value: ['root'] }],
        ] as const) {
          results[`${method} ${path}`] = (
            await fetch(`${root}/api/${path}`, {
              method,
              headers: {
                'content-type': 'application/json',
                'Idempotency-Key': operationKey,
              },
              body: JSON.stringify(body),
            })
          ).status;
        }
        return results;
      },
      {
        root,
        userId: account.id,
        operationKey: `${Date.now()}.${randomUUID()}`,
      },
    );
    expect(Object.keys(statuses)).toHaveLength(7);
    for (const [operation, status] of Object.entries(statuses))
      expect(status, operation).toBe(403);
    await ordinary.screenshot({
      path: testInfo.outputPath('ordinary-user-access-denied.png'),
      fullPage: true,
    });
  } finally {
    await ordinaryContext.close();
  }
});

test('existing management pages remain usable at phone widths', async ({
  page,
  context,
  acceptance,
}, testInfo) => {
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  const admin = await signIn(acceptance.server, acceptance.credentials);
  expect(
    (
      await admin.fetch(
        '/users',
        mutation({
          name: 'Phone acceptance user',
          username: 'phoneacceptance',
          email: 'phone-acceptance@example.test',
          password: `Acceptance-${randomUUID()}!`,
        }),
      )
    ).status,
  ).toBe(201);
  for (const width of [375, 390]) {
    await page.setViewportSize({ width, height: 667 });
    for (const path of ['settings', 'settings/users', 'settings/roles']) {
      await page.goto(`${applicationUrl!.replace(/\/$/, '')}/${path}`);
      await expect(page.locator('h1')).toBeVisible();
      expect(
        await page
          .locator('html')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
    }
    await page.screenshot({
      path: testInfo.outputPath(`management-phone-${width}.png`),
      fullPage: true,
    });
  }
});
