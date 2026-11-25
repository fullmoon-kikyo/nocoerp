import { randomUUID } from 'node:crypto';
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import { createTestApp, type TestApp } from '@nocobase/app-testing/server';
import { signIn } from '@nocobase/app-plugin-authentication/testing';
import { blankMaterial } from '../../shared/material-master-data.js';
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
  await expect(page.getByRole('main')).toBeVisible();
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

test('material navigation, category hierarchy, material create/edit and ordinary-user boundaries work end to end', async ({
  page,
  context,
  browser,
  acceptance,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  await expect(
    page.getByText('Material management', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'Master data management', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Master data management', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('materials-empty.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'New category', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: 'New category', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Category code *', exact: true })
    .fill('RAW');
  await dialog
    .getByRole('textbox', { name: 'Category name *', exact: true })
    .pressSequentially('Raw materials');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Raw materials', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New category', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'New category', exact: true });
  await expect(
    dialog.getByRole('combobox', { name: 'Parent category', exact: true }),
  ).toContainText('RAW');
  await dialog
    .getByRole('textbox', { name: 'Category code *', exact: true })
    .fill('STEEL');
  await dialog
    .getByRole('textbox', { name: 'Category name *', exact: true })
    .fill('Steel');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Steel', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'New material', exact: true }).click();
  await expect(
    page.getByRole('combobox', { name: 'Material category *', exact: true }),
  ).toContainText('STEEL');
  await page
    .getByRole('textbox', { name: 'Material code *', exact: true })
    .fill('MAT-001');
  const name = page.getByRole('textbox', {
    name: 'Material name *',
    exact: true,
  });
  await name.pressSequentially('Die steel');
  await name.press('Home');
  await name.pressSequentially('H13 ');
  await page
    .getByRole('textbox', { name: 'Unit of measure *', exact: true })
    .fill('kg');
  await page
    .getByRole('textbox', { name: 'Specification', exact: true })
    .fill('300 × 200 × 100');
  await page
    .getByRole('textbox', { name: 'Drawing number', exact: true })
    .fill('DWG-001');
  await page
    .getByRole('textbox', { name: 'Material grade', exact: true })
    .fill('H13');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const material = page.getByRole('link', { name: 'MAT-001', exact: true });
  await expect(material).toBeVisible();
  await page
    .getByRole('button', { name: 'Raw materials', exact: true })
    .click();
  await expect(material).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('materials-tree-table.png'),
    fullPage: true,
  });
  await material.click();
  await page
    .getByRole('textbox', { name: 'Specification', exact: true })
    .fill('350 × 250 × 100');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(material).toBeVisible();
  await expect(
    page.getByText('350 × 250 × 100', { exact: true }),
  ).toBeVisible();

  const admin = await signIn(acceptance.server, acceptance.credentials);
  const listed = await admin.fetch('/materialMaster/materials');
  const row = (await listed.json()).data[0];
  expect(row.version).toBe(2);
  expect(row.name).toBe('H13 Die steel');
  const credentials = {
    username: 'materialviewer',
    name: 'Material viewer',
    email: 'material-viewer@example.test',
    password: `Material-${randomUUID()}!`,
  };
  expect(
    (
      await admin.fetch(
        '/users',
        mutation({ ...credentials, roleScopes: { app: ['material-viewer'] } }),
      )
    ).status,
  ).toBe(201);
  const viewerContext = await browser.newContext();
  try {
    await acceptance.connect(viewerContext);
    const viewer = await viewerContext.newPage();
    await logIn(viewer, credentials);
    await viewer
      .getByRole('link', { name: 'Master data management', exact: true })
      .click();
    await expect(
      viewer.getByRole('button', { name: 'New material', exact: true }),
    ).toHaveCount(0);
    await expect(
      viewer.getByRole('button', { name: 'New category', exact: true }),
    ).toHaveCount(0);
    await viewer.getByRole('link', { name: 'MAT-001', exact: true }).click();
    await expect(
      viewer.getByRole('textbox', { name: 'Material name *', exact: true }),
    ).toBeDisabled();
    await expect(
      viewer.getByRole('button', { name: 'Save', exact: true }),
    ).toHaveCount(0);
    const status = await viewer.evaluate(
      async (input) =>
        (
          await fetch(
            `${location.origin}${location.pathname.split('/materials/')[0]}/api/materialMaster/materials`,
            {
              method: 'POST',
              headers: {
                'content-type': 'application/json',
                'Idempotency-Key': `${Date.now()}.${crypto.randomUUID()}`,
              },
              body: JSON.stringify(input),
            },
          )
        ).status,
      {
        ...blankMaterial,
        categoryId: row.categoryId,
        code: 'FORBIDDEN',
        name: 'Forbidden',
        unit: 'kg',
      },
    );
    expect(status).toBe(403);
  } finally {
    await viewerContext.close();
  }
  expect(errors).toEqual([]);
});

test.describe('mobile materials', () => {
  test.use({ isMobile: true, hasTouch: true });
  test('category selection, validation, creation and editing work at 375 and 390 pixels', async ({
    page,
    context,
    acceptance,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 375, height: 667 });
    await acceptance.connect(context);
    await logIn(page, acceptance.credentials);
    await page.goto(
      `${applicationUrl!.replace(/\/$/, '')}/materials/master-data`,
    );
    await page.getByRole('button', { name: 'New category', exact: true }).tap();
    const dialog = page.getByRole('dialog', {
      name: 'New category',
      exact: true,
    });
    await dialog
      .getByRole('textbox', { name: 'Category code *', exact: true })
      .fill('SHOP');
    await dialog
      .getByRole('textbox', { name: 'Category name *', exact: true })
      .fill('Workshop materials');
    await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(dialog).toHaveCount(0);
    await page.getByRole('button', { name: 'New material', exact: true }).tap();
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(
      page.getByRole('textbox', { name: 'Material code *', exact: true }),
    ).toBeFocused();
    await page
      .getByRole('textbox', { name: 'Material code *', exact: true })
      .fill('PHONE-001');
    const name = page.getByRole('textbox', {
      name: 'Material name *',
      exact: true,
    });
    await name.focus();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.imeSetComposition', {
      text: 'moju',
      selectionStart: 4,
      selectionEnd: 4,
    });
    await cdp.send('Input.insertText', { text: '模具钢' });
    await expect(name).toHaveValue('模具钢');
    await page
      .getByRole('textbox', { name: 'Unit of measure *', exact: true })
      .fill('kg');
    await page.screenshot({
      path: testInfo.outputPath('material-phone-form-375.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(
      page.getByRole('link', { name: 'PHONE-001', exact: true }),
    ).toBeVisible();
    for (const width of [375, 390]) {
      await page.setViewportSize({ width, height: 667 });
      await expect(page.locator('[data-slot="data-table-card"]')).toHaveCount(
        1,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`material-phone-list-${width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('link', { name: 'PHONE-001', exact: true }).tap();
    await page
      .getByRole('textbox', { name: 'Remarks', exact: true })
      .fill('Reviewed on phone');
    await page.getByRole('button', { name: 'Save', exact: true }).tap();
    await expect(
      page.getByRole('link', { name: 'PHONE-001', exact: true }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });
});
