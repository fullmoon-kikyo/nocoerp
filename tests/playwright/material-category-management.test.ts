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

async function createCategory(
  acceptance: AcceptanceApp,
  code: string,
  name: string,
  parentId: string | null = null,
) {
  const admin = await signIn(acceptance.server, acceptance.credentials);
  const response = await admin.fetch(
    '/materialMaster/categories',
    mutation({ code, name, parentId, description: `${name} notes` }),
  );
  expect(response.status).toBe(201);
  return (await response.json()).data;
}

async function chooseAppearance(page: Page, option: string, touch = false) {
  const activate = async (locator: ReturnType<Page['getByRole']>) => {
    if (touch) await locator.tap();
    else await locator.click();
  };
  await activate(
    page.getByRole('button', { name: 'Open account menu', exact: true }),
  );
  await activate(page.getByRole('menuitem', { name: 'Theme', exact: true }));
  await activate(
    page.getByRole('menuitemradio', { name: option, exact: true }),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
}

async function more(page: Page, action: string) {
  await page
    .getByRole('button', { name: 'More actions', exact: true })
    .first()
    .click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

test('category template, edit/move/delete protection, CSV and comments persist through real APIs', async ({
  page,
  context,
  acceptance,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const root = await createCategory(acceptance, 'RAW', 'Raw materials');
  const child = await createCategory(acceptance, 'STEEL', 'Die steel', root.id);
  await createCategory(acceptance, 'TOOLS', 'Tools');
  const admin = await signIn(acceptance.server, acceptance.credentials);
  expect(
    (
      await admin.fetch(
        '/materialMaster/materials',
        mutation({
          ...blankMaterial,
          code: 'H13-001',
          name: 'H13 die steel',
          categoryId: child.id,
          unit: 'kg',
        }),
      )
    ).status,
  ).toBe(201);
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  await page
    .getByRole('link', { name: 'Material categories', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: /^Material categories/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Raw materials', exact: true }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('categories-template-1440.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Die steel', exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`selected=${child.id}`));
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Die steel', exact: true }),
  ).toBeVisible();
  await page.getByRole('tab', { name: /^Materials/ }).click();
  await expect(page.getByText('H13-001', { exact: true })).toBeVisible();
  await page.goto(
    `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${child.id}&tab=materials&q=STEEL`,
  );
  await page.getByRole('link', { name: 'H13-001', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/materials/categories/materials/`));
  await expect(
    page.getByRole('textbox', { name: 'Material code *', exact: true }),
  ).toHaveValue('H13-001');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`selected=${child.id}`));
  await expect(page).toHaveURL(/tab=materials/);
  await expect(page).toHaveURL(/q=STEEL/);
  await page.getByRole('tab', { name: 'History', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Write a comment…', exact: true })
    .fill('Steel needs inspection');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(
    page.getByText('Steel needs inspection', { exact: true }),
  ).toBeVisible();
  await page
    .locator('li')
    .filter({ hasText: 'Steel needs inspection' })
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await page.getByRole('menuitem', { name: 'Reply', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Write a comment…', exact: true })
    .fill('Inspection scheduled');
  await page.getByRole('button', { name: 'Post', exact: true }).click();
  await expect(
    page.getByText('Inspection scheduled', { exact: true }),
  ).toBeVisible();
  await page
    .locator('li')
    .filter({ hasText: 'Steel needs inspection' })
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Edit comment', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Edit comment', exact: true })
    .fill('Steel inspected');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByText('Steel inspected', { exact: true }),
  ).toBeVisible();
  await page
    .locator('li')
    .filter({ hasText: 'Steel inspected' })
    .getByRole('button', { name: 'More actions', exact: true })
    .click();
  await page
    .getByRole('menuitem', { name: 'Delete comment', exact: true })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete comment', exact: true })
    .click();
  await expect(
    page.getByText('Comment removed', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Inspection scheduled', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear filters', exact: true })
    .click();
  await more(page, 'Edit category');
  let dialog = page.getByRole('dialog', { name: 'Edit category', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Category name *', exact: true })
    .fill('Mould steel');
  await dialog
    .getByRole('textbox', { name: 'Notes', exact: true })
    .fill('Updated notes');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Mould steel', exact: true }),
  ).toBeVisible();
  await more(page, 'Move category');
  dialog = page.getByRole('dialog', { name: 'Move category', exact: true });
  await dialog
    .getByRole('combobox', { name: 'Parent category', exact: true })
    .click();
  await page.getByRole('option', { name: 'No parent', exact: true }).click();
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await more(page, 'Delete category');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete category', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toContainText(
    'material references',
  );
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Cancel', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Import categories', exact: true })
    .click();
  dialog = page.getByRole('dialog', { name: 'Import categories', exact: true });
  const templateDownload = page.waitForEvent('download');
  await dialog
    .getByRole('button', { name: 'Download CSV template', exact: true })
    .click();
  expect((await templateDownload).suggestedFilename()).toContain(
    'template.csv',
  );
  await dialog.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'bad.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'code,name,parentCode,description\nIMPORTED,Imported,MISSING,\n',
    ),
  });
  await dialog
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click();
  await expect(
    dialog.getByText('Parent code is unavailable', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Import all valid rows', exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'valid.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'code,name,parentCode,description\nIMPORTED,Imported,RAW,Imported note\n',
    ),
  });
  await dialog
    .getByRole('button', { name: 'Validate and preview', exact: true })
    .click();
  await expect(dialog).toContainText('Validation passed');
  await page.screenshot({
    path: testInfo.outputPath('categories-import-preview.png'),
    fullPage: true,
  });
  await dialog
    .getByRole('button', { name: 'Import all valid rows', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Imported', exact: true }),
  ).toBeVisible();
  const exportDownload = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export categories', exact: true })
    .click();
  expect((await exportDownload).suggestedFilename()).toBe(
    'material-categories.csv',
  );
  await more(page, 'Delete category');
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Delete category', exact: true })
    .click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  const rows = (await (await admin.fetch('/materialMaster/categories')).json())
    .data;
  expect(rows.some((row: { code: string }) => row.code === 'IMPORTED')).toBe(
    false,
  );
  expect(rows.find((row: { id: string }) => row.id === child.id).parentId).toBe(
    null,
  );
  expect(rows.find((row: { id: string }) => row.id === child.id).name).toBe(
    'Mould steel',
  );
  expect(errors).toEqual([]);
});

for (const width of [375, 390])
  test(`phone ${width}: creation, editing, comments, movement and no horizontal overflow`, async ({
    browser,
    acceptance,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width, height: 667 },
      isMobile: true,
      hasTouch: true,
    });
    try {
      const root = await createCategory(
        acceptance,
        'PHONE',
        '模具生产原材料及配套辅料长名称',
      );
      let parentId = root.id;
      for (let i = 0; i < 5; i++)
        parentId = (
          await createCategory(
            acceptance,
            `LEVEL${i}`,
            `深层分类${i}`,
            parentId,
          )
        ).id;
      await acceptance.connect(context);
      const page = await context.newPage();
      await logIn(page, acceptance.credentials);
      await page.goto(
        `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${root.id}`,
      );
      await expect(
        page.getByRole('combobox', { name: 'Category path', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Create subcategory', exact: true })
        .tap();
      let dialog = page.getByRole('dialog', {
        name: 'New category',
        exact: true,
      });
      await dialog
        .getByRole('textbox', { name: 'Category code *', exact: true })
        .fill(`PHONE${width}`);
      const name = dialog.getByRole('textbox', {
        name: 'Category name *',
        exact: true,
      });
      await name.dispatchEvent('compositionstart');
      await name.fill('模具钢材');
      await name.dispatchEvent('compositionend', { data: '模具钢材' });
      await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
      await expect(dialog).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: '模具钢材', exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'More actions', exact: true })
        .first()
        .tap();
      await page
        .getByRole('menuitem', { name: 'Edit category', exact: true })
        .tap();
      dialog = page.getByRole('dialog', { name: 'Edit category', exact: true });
      await dialog
        .getByRole('textbox', { name: 'Category name *', exact: true })
        .fill('手机修改钢材');
      await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole('textbox', { name: 'Write a comment…', exact: true })
        .fill('手机中文评论');
      await page.getByRole('button', { name: 'Post', exact: true }).tap();
      await expect(
        page.getByText('手机中文评论', { exact: true }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'More actions', exact: true })
        .first()
        .tap();
      await page
        .getByRole('menuitem', { name: 'Move category', exact: true })
        .tap();
      dialog = page.getByRole('dialog', { name: 'Move category', exact: true });
      await dialog
        .getByRole('combobox', { name: 'Parent category', exact: true })
        .tap();
      await page.getByRole('option', { name: 'No parent', exact: true }).tap();
      await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
      await expect(dialog).toHaveCount(0);
      await page
        .getByRole('button', { name: 'Category tree', exact: true })
        .tap();
      await page.screenshot({
        path: testInfo.outputPath(`categories-phone-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await chooseAppearance(page, 'Dark', true);
      await expect(page.locator('html')).toHaveClass(/dark/);
      await expect
        .poll(() =>
          page.locator('html').evaluate((element) => element.style.colorScheme),
        )
        .toBe('dark');
      await page.screenshot({
        path: testInfo.outputPath(`categories-phone-${width}-dark.png`),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });

test('dragging saves the new hierarchy; reader and ordinary accounts retain their boundaries', async ({
  page,
  context,
  browser,
  acceptance,
}, testInfo) => {
  const root = await createCategory(acceptance, 'DRAG-ROOT', 'Drag root');
  const leaf = await createCategory(acceptance, 'DRAG-LEAF', 'Drag leaf');
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  await page.goto(
    `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${leaf.id}`,
  );
  const source = page
    .getByRole('button', { name: 'Drag leaf', exact: true })
    .first()
    .locator('..');
  const target = page
    .getByRole('button', { name: 'Drag root', exact: true })
    .first()
    .locator('..');
  await source.dragTo(target);
  const admin = await signIn(acceptance.server, acceptance.credentials);
  await expect
    .poll(
      async () =>
        (
          await (await admin.fetch('/materialMaster/categories')).json()
        ).data.find((row: { id: string }) => row.id === leaf.id).parentId,
    )
    .toBe(root.id);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Drag leaf', exact: true }),
  ).toBeVisible();
  // A category viewer has page/data viewing, but no create/edit/comment/import/export operations.
  for (const [username, roles] of [
    ['categoryreader', ['material-category-viewer']],
    ['categoryordinary', []],
  ] as const) {
    const credentials = {
      username,
      name: username,
      email: `${username}@example.test`,
      password: `Isolated-${randomUUID()}!`,
    };
    expect(
      (
        await admin.fetch(
          '/users',
          mutation({ ...credentials, roleScopes: { app: [...roles] } }),
        )
      ).status,
    ).toBe(201);
    const accountContext = await browser.newContext();
    try {
      await acceptance.connect(accountContext);
      const accountPage = await accountContext.newPage();
      await logIn(accountPage, credentials);
      if (roles.length) {
        await accountPage
          .getByRole('link', { name: 'Material categories', exact: true })
          .click();
        await expect(
          accountPage.getByRole('heading', { name: 'Drag root', exact: true }),
        ).toBeVisible();
        await expect(
          accountPage.getByRole('button', {
            name: 'Create category',
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          accountPage.getByRole('button', {
            name: 'More actions',
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          accountPage.getByRole('textbox', {
            name: 'Write a comment…',
            exact: true,
          }),
        ).toHaveCount(0);
        await accountPage.screenshot({
          path: testInfo.outputPath('categories-reader.png'),
          fullPage: true,
        });
      } else {
        await expect(
          accountPage.getByRole('link', {
            name: 'Material categories',
            exact: true,
          }),
        ).toHaveCount(0);
        await accountPage.goto(
          `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${root.id}`,
        );
        await expect(
          accountPage.getByRole('heading', { name: 'Drag root', exact: true }),
        ).toHaveCount(0);
      }
      const session = await signIn(acceptance.server, credentials);
      expect(
        (
          await session.fetch(
            `/materialMaster/categories/${root.id}/comments`,
            mutation({ body: 'Denied' }),
          )
        ).status,
      ).toBe(403);
      expect(
        (await session.fetch('/materialMaster/categories/export')).status,
      ).toBe(403);
      expect(
        (
          await session.fetch(
            '/materialMaster/categories/import/preview',
            mutation({ csv: 'code,name\nBAD,Bad\n' }),
          )
        ).status,
      ).toBe(403);
      expect(
        (await session.fetch(`/materialMaster/categories/${root.id}/history`))
          .status,
      ).toBe(roles.length ? 200 : 403);
    } finally {
      await accountContext.close();
    }
  }
});

test('Chinese localization, actual theme choices and draft cancellation protect data', async ({
  page,
  context,
  acceptance,
}, testInfo) => {
  const row = await createCategory(acceptance, 'REVIEW', '模具钢材');
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  await page.goto(
    `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${row.id}`,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A discarded inline draft must not disable protection for the next edit.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole('heading', { name: '模具钢材', exact: true })
      .getByRole('button')
      .click();
    await page
      .getByRole('textbox', { name: 'Category name', exact: true })
      .fill(`Unsaved ${attempt}`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    const question = page.getByRole('alertdialog', {
      name: 'Discard changes?',
      exact: true,
    });
    await expect(question).toBeVisible();
    await question.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect(
      page.getByRole('textbox', { name: 'Category name', exact: true }),
    ).toHaveValue(`Unsaved ${attempt}`);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await question
      .getByRole('button', { name: 'Confirm', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: '模具钢材', exact: true }),
    ).toBeVisible();
  }
  await page
    .getByRole('button', { name: 'Create category', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'New category',
    exact: true,
  });
  await dialog
    .getByRole('textbox', { name: 'Category code *', exact: true })
    .fill('DRAFT');
  await page.keyboard.press('Escape');
  let question = page.getByRole('alertdialog', {
    name: 'Discard changes?',
    exact: true,
  });
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    dialog.getByRole('textbox', { name: 'Category code *', exact: true }),
  ).toHaveValue('DRAFT');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  question = page.getByRole('alertdialog', {
    name: 'Discard changes?',
    exact: true,
  });
  await question.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // Both preset families, using the real account-menu provider rather than CSS class injection.
  for (const preset of ['Spacious', 'Compact']) {
    await chooseAppearance(page, preset);
    for (const mode of ['Light', 'Dark']) {
      await chooseAppearance(page, mode);
      await expect(page.locator('html')).toHaveAttribute(
        'data-theme',
        preset === 'Spacious' ? 'default' : 'compact',
      );
      await expect
        .poll(() =>
          page.locator('html').evaluate((element) => element.style.colorScheme),
        )
        .toBe(mode.toLowerCase());
      await page.screenshot({
        path: testInfo.outputPath(
          `categories-${preset.toLowerCase()}-${mode.toLowerCase()}.png`,
        ),
        fullPage: true,
      });
    }
  }
  await page
    .getByRole('button', { name: 'Open account menu', exact: true })
    .click();
  await page.getByRole('menuitem', { name: /^Language/ }).click();
  await page.getByRole('menuitemradio', { name: /中文/ }).click();
  await expect(page.getByRole('heading', { name: /^物料分类/ })).toBeVisible();
  await expect(
    page.getByRole('tab', { name: '历史', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: '创建分类', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('categories-zh-cn.png'),
    fullPage: true,
  });
  const admin = await signIn(acceptance.server, acceptance.credentials);
  const saved = (await (await admin.fetch('/materialMaster/categories')).json())
    .data;
  expect(saved).toHaveLength(1);
  expect(saved[0].name).toBe('模具钢材');
});

test('list loading/error recovery and corrected field errors match real state', async ({
  page,
  context,
  acceptance,
}, testInfo) => {
  const row = await createCategory(acceptance, 'STATE', 'State category');
  await acceptance.connect(context);
  await logIn(page, acceptance.credentials);
  const list = '**/api/materialMaster/categories';
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(list, async (route) => {
    await barrier;
    await route.fallback();
  });
  await page.goto(`${applicationUrl!.replace(/\/$/, '')}/materials/categories`);
  await expect(
    page.getByRole('heading', { name: /^Material categories/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Create category', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('status', { name: 'Loading', exact: true }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole('heading', { name: 'State category', exact: true }),
  ).toBeVisible();
  await page.unroute(list);
  for (const status of [500, 403]) {
    await page.route(list, (route) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify({
          error: {
            code: status === 403 ? 'PERMISSION_DENIED' : 'INTERNAL',
            message: 'Synthetic state check',
          },
        }),
      }),
    );
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Create category', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(status === 403 ? 'Access denied' : 'Unable to load list', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Retry', exact: true }),
    ).toHaveCount(status === 500 ? 1 : 0);
    await expect(
      page.getByRole('heading', { name: 'State category', exact: true }),
    ).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(`categories-state-${status}.png`),
      fullPage: true,
    });
    await page.unroute(list);
    if (status === 500)
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    else await page.reload();
    await expect(
      page.getByRole('heading', { name: 'State category', exact: true }),
    ).toBeVisible();
  }
  await more(page, 'Edit category');
  const dialog = page.getByRole('dialog', {
    name: 'Edit category',
    exact: true,
  });
  const code = dialog.getByRole('textbox', {
    name: 'Category code *',
    exact: true,
  });
  await code.fill('BAD CODE');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute(
    'aria-describedby',
    'category-edit-code-error',
  );
  await expect(
    dialog.getByText('Enter a category code without spaces.', { exact: true }),
  ).toBeVisible();
  await code.fill('STATE');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.goto(
    `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=missing`,
  );
  await expect(
    page.getByText('This category is unavailable.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Select first category', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`selected=${row.id}`));
});

test('history paging, short phone import and delayed export/delete keep usable feedback', async ({
  browser,
  acceptance,
}, testInfo) => {
  const root = await createCategory(acceptance, 'PAGED', 'History and import');
  await createCategory(
    acceptance,
    'LONG',
    `长分类名称${'模具材料'.repeat(16)}`,
    root.id,
  );
  const admin = await signIn(acceptance.server, acceptance.credentials);
  for (let index = 0; index < 21; index++)
    expect(
      (
        await admin.fetch(
          `/materialMaster/categories/${root.id}/comments`,
          mutation({ body: `History item ${index}` }),
        )
      ).status,
    ).toBe(200);
  const context = await browser.newContext({
    viewport: { width: 375, height: 500 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await acceptance.connect(context);
    const page = await context.newPage();
    await logIn(page, acceptance.credentials);
    await page.goto(
      `${applicationUrl!.replace(/\/$/, '')}/materials/categories?selected=${root.id}`,
    );
    await page
      .getByRole('combobox', { name: 'Category path', exact: true })
      .tap();
    const longOption = page.getByRole('option', { name: /长分类名称/ });
    const optionBox = await longOption.boundingBox();
    expect(optionBox).not.toBeNull();
    expect(optionBox!.x).toBeGreaterThanOrEqual(0);
    expect(optionBox!.x + optionBox!.width).toBeLessThanOrEqual(375);
    expect(optionBox!.height).toBeGreaterThan(32);
    await page
      .getByRole('option', { name: 'History and import', exact: true })
      .tap();
    await page
      .getByRole('button', { name: 'Category tree', exact: true })
      .tap();
    const touchBox = await page
      .getByRole('button', { name: 'Collapse History and import', exact: true })
      .boundingBox();
    expect(touchBox!.width).toBeGreaterThanOrEqual(32);
    expect(touchBox!.height).toBeGreaterThanOrEqual(32);
    await page
      .getByRole('button', { name: 'Category tree', exact: true })
      .tap();
    await page.getByRole('button', { name: 'Next', exact: true }).tap();
    await expect(page).toHaveURL(/historyPage=2/);
    await expect(
      page.getByText('History item 0', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Previous', exact: true }).tap();
    await page.getByRole('button', { name: 'Changes', exact: true }).tap();
    await expect(
      page.getByRole('button', { name: 'Next', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'All', exact: true }).tap();
    await page.getByRole('button', { name: 'More', exact: true }).tap();
    await page
      .getByRole('menuitem', { name: 'Import categories', exact: true })
      .tap();
    const dialog = page.getByRole('dialog', {
      name: 'Import categories',
      exact: true,
    });
    const csv =
      'code,name,parentCode,description\n' +
      Array.from(
        { length: 30 },
        (_, index) => `PREVIEW-${index},Imported ${index},PAGED,Notes`,
      ).join('\n');
    await dialog.getByLabel('CSV file', { exact: true }).setInputFiles({
      name: 'preview.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv),
    });
    await dialog
      .getByRole('button', { name: 'Validate and preview', exact: true })
      .tap();
    await expect(dialog).toContainText('Validation passed');
    const commit = dialog.getByRole('button', {
      name: 'Import all valid rows',
      exact: true,
    });
    await expect(commit).toBeEnabled();
    const bounds = await commit.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(500);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(375);
    expect(
      await commit.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return element.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('categories-phone-import-short.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Confirm', exact: true })
      .tap();
    await expect(dialog).toHaveCount(0);
    let releaseExport!: () => void;
    const exportBarrier = new Promise<void>((resolve) => {
      releaseExport = resolve;
    });
    const exportPath = /\/api\/materialMaster\/categories\/export(?:\?|$)/;
    await page.route(exportPath, async (route) => {
      await exportBarrier;
      await route.fallback();
    });
    await page.getByRole('button', { name: 'More', exact: true }).tap();
    const download = page.waitForEvent('download');
    await page
      .getByRole('menuitem', { name: 'Export categories', exact: true })
      .tap();
    const exporting = page.getByRole('button', { name: /Working/ });
    await expect(exporting).toBeDisabled();
    await expect(exporting).toHaveAttribute('aria-busy', 'true');
    releaseExport();
    expect((await download).suggestedFilename()).toBe(
      'material-categories.csv',
    );
    await expect(exporting).toHaveCount(0);
    await page.unroute(exportPath);
    await page
      .getByRole('button', { name: 'More actions', exact: true })
      .first()
      .tap();
    await page
      .getByRole('menuitem', { name: 'Delete category', exact: true })
      .tap();
    const confirmation = page.getByRole('alertdialog');
    let releaseDelete!: () => void;
    const deleteBarrier = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const deletePath = `**/api/materialMaster/categories/${root.id}`;
    await page.route(deletePath, async (route) => {
      if (route.request().method() === 'DELETE') await deleteBarrier;
      await route.fallback();
    });
    await confirmation
      .getByRole('button', { name: 'Delete category', exact: true })
      .tap();
    await expect(
      confirmation.getByRole('button', { name: /Saving/ }),
    ).toBeDisabled();
    await expect(
      confirmation.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(confirmation).toBeVisible();
    releaseDelete();
    await expect(confirmation.getByText(/cannot be deleted/)).toBeVisible();
    await page.unroute(deletePath);
    await confirmation
      .getByRole('button', { name: 'Cancel', exact: true })
      .tap();
    await expect(confirmation).toHaveCount(0);
    expect(
      (await (await admin.fetch('/materialMaster/categories')).json()).data,
    ).toHaveLength(2);
  } finally {
    await context.close();
  }
});
