import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createTestApp, type TestApp } from '@nocobase/app-testing/server';
import { signIn } from '@nocobase/app-plugin-authentication/testing';
import { registerSharingFixture } from '../helpers/sharing-fixture.js';
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

test.use({ actionTimeout: 15000 });
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

test('sharing management supports an empty app, explicit recipients, create/edit/revoke and ordinary-user denial', async ({
  page,
  context,
  browser,
  acceptance,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  const baseUrl = applicationUrl!.replace(/\/$/, '');
  await page.goto(`${baseUrl}/settings/sharing-rules`);
  await expect(
    page.getByRole('tab', { name: 'Sharing rules', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'New sharing rule', exact: true }),
  ).toBeEnabled();
  // Material master data is now registered; an empty rules list can already create a rule.
  await page.screenshot({
    path: testInfo.outputPath('sharing-empty.png'),
    fullPage: true,
  });

  await registerSharingFixture(acceptance.server);
  const admin = await signIn(acceptance.server, acceptance.credentials);
  const account = {
    name: 'Sharing recipient',
    username: 'sharingrecipient',
    email: 'sharing-recipient@example.test',
    password: `Sharing-${randomUUID()}!`,
  };
  const created = await admin.fetch('/users', mutation(account));
  expect(created.status).toBe(201);
  const recipient = (await created.json()).data;
  const untouched = {
    key: 'other-rule',
    title: 'Keep other rule',
    resource: { type: 'composite', id: 'sharing.acceptance' },
    subjects: [{ type: 'user', id: recipient.id }],
    actions: [
      {
        action: 'view',
        scopeKey: 'items',
        selection: { type: 'records', ids: ['independent'] },
      },
    ],
  };
  expect(
    (await admin.fetch('/authorization/sharingRules', mutation(untouched)))
      .status,
  ).toBe(201);
  await page.reload();
  await page
    .getByRole('button', { name: 'New sharing rule', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Key *', exact: true })
    .fill('browser-handover');
  await page
    .getByRole('textbox', { name: 'Rule name', exact: true })
    .pressSequentially('Workshop handover');
  await page
    .getByRole('combobox', { name: 'Business object *', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Acceptance records', exact: true })
    .click();
  await page.getByRole('combobox', { name: /^View records ·/ }).click();
  await expect(
    page.getByRole('option', { name: 'All records', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('option', { name: 'Select specific records', exact: true })
    .click();
  await page.getByRole('checkbox', { name: /delegated/ }).check();
  await page.getByRole('checkbox', { name: /Sharing recipient/ }).check();
  await expect(
    page.getByRole('button', { name: 'Remove recipient Sharing recipient' }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Reason for sharing', exact: true })
    .fill('Temporary machining collaboration');
  await page.screenshot({
    path: testInfo.outputPath('sharing-explicit-selection.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Workshop handover', exact: true }),
  ).toBeVisible();
  let rules = (await (await admin.fetch('/authorization/sharingRules')).json())
    .data;
  const rule = rules.find(
    (rule: { key: string }) => rule.key === 'browser-handover',
  );
  expect(rule.subjects).toEqual([{ type: 'user', id: recipient.id }]);
  expect(rule.actions).toEqual([
    {
      action: 'view',
      scopeKey: 'items',
      selection: { type: 'records', ids: ['delegated'] },
    },
  ]);
  await page
    .getByRole('link', { name: 'Workshop handover', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Rule name', exact: true })
    .fill('Reviewed workshop handover');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const link = page.getByRole('link', {
    name: 'Reviewed workshop handover',
    exact: true,
  });
  await expect(link).toBeVisible();
  await link
    .locator('xpath=ancestor::tr')
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page
    .getByRole('menuitem', { name: 'Revoke sharing', exact: true })
    .click();
  const revoked = page.waitForResponse(
    (response) =>
      response.url().endsWith('/authorization/sharingRules/browser-handover') &&
      response.request().method() === 'DELETE',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Revoke sharing', exact: true })
    .click();
  expect((await revoked).status()).toBe(204);
  await expect(link).toHaveCount(0);
  rules = (await (await admin.fetch('/authorization/sharingRules')).json())
    .data;
  expect(rules).toEqual([expect.objectContaining(untouched)]);

  const ordinaryContext = await browser.newContext();
  try {
    await acceptance.connect(ordinaryContext);
    const ordinary = await ordinaryContext.newPage();
    await logIn(ordinary, account);
    await ordinary.goto(`${baseUrl}/settings/sharing-rules`);
    await expect(
      ordinary.getByRole('heading', { name: 'Access denied', exact: true }),
    ).toBeVisible();
    const statuses = await ordinary.evaluate(async () => {
      const root = `${location.origin}${location.pathname.split('/settings/')[0]}/api/authorization/sharingRules`;
      return Promise.all(
        [
          fetch(root),
          fetch(`${root}/options`),
          fetch(`${root}/subjects/user`),
          fetch(`${root}/records/sharingItems`),
          fetch(root, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
          fetch(`${root}/other-rule`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
          fetch(`${root}/other-rule`, { method: 'DELETE' }),
        ].map(async (response) => (await response).status),
      );
    });
    expect(statuses).toEqual(Array(7).fill(403));
  } finally {
    await ordinaryContext.close();
  }
  expect(pageErrors).toEqual([]);
});

test.describe('touch screens', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('sharing list and editor fit touch screens and require an explicit recipient', async ({
    page,
    context,
    acceptance,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await acceptance.connect(context);
    await registerSharingFixture(acceptance.server);
    await logIn(page, acceptance.credentials);
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 667 });
      await page.goto(
        `${applicationUrl!.replace(/\/$/, '')}/settings/sharing-rules`,
      );
      await page
        .getByRole('button', { name: 'New sharing rule', exact: true })
        .click();
      await page
        .getByRole('textbox', { name: 'Key *', exact: true })
        .fill('mobile-handover');
      await page
        .getByRole('combobox', { name: 'Business object *', exact: true })
        .click();
      await page
        .getByRole('option', { name: 'Acceptance records', exact: true })
        .click();
      await page.getByRole('combobox', { name: /^View records ·/ }).click();
      await page
        .getByRole('option', { name: 'Select specific records', exact: true })
        .click();
      await page.getByRole('checkbox', { name: /delegated/ }).check();
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        page.getByText('Choose at least one specific recipient.', {
          exact: true,
        }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`sharing-mobile-${width}.png`),
        fullPage: true,
      });
      if (width === 375) {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Confirm', exact: true })
          .click();
      } else {
        await page.getByRole('checkbox', { name: /Super Admin/ }).check();
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        const link = page.getByRole('link', {
          name: 'mobile-handover',
          exact: true,
        });
        await expect(link).toBeVisible();
        await expect(page.locator('[data-slot="data-table-card"]')).toHaveCount(
          1,
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: testInfo.outputPath('sharing-mobile-cards.png'),
          fullPage: true,
        });
        await link.click();
        await page
          .getByRole('textbox', { name: 'Reason for sharing', exact: true })
          .fill('Reviewed on phone');
        await page.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(link).toBeVisible();
        await page
          .getByRole('button', {
            name: 'Actions for mobile-handover',
            exact: true,
          })
          .click();
        await page
          .getByRole('menuitem', { name: 'Revoke sharing', exact: true })
          .click();
        const revoked = page.waitForResponse(
          (response) =>
            response
              .url()
              .endsWith('/authorization/sharingRules/mobile-handover') &&
            response.request().method() === 'DELETE',
        );
        await page
          .getByRole('alertdialog')
          .getByRole('button', { name: 'Revoke sharing', exact: true })
          .click();
        expect((await revoked).status()).toBe(204);
        await expect(link).toHaveCount(0);
      }
    }
    expect(pageErrors).toEqual([]);
  });
});
