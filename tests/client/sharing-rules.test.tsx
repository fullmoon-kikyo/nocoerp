import { renderSettingsClient } from '../helpers/settings-client.js';
import { answerApi } from '@nocobase/app-testing/client';
import { apiClientToken, type ClientApplication } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationOptionsResponse,
} from '@nocobase/app-plugin-authorization/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route } from 'react-router';
import { expect, it, vi } from 'vitest';
import Page from '../../client/pages/settings/sharing-rules.js';
import Form from '../../client/pages/settings/sharing-rule-form.js';
import {
  validSharingActions,
  type SharingRule,
} from '../../client/pages/settings/sharing-rules-model.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';

const namespace = '@nocoerp/sharing-test';
const namespaces = {
  [namespace]: {
    'en-US': async () => ({ default: enUS }),
    'zh-CN': async () => ({ default: zhCN }),
  },
};
const services = (app: ClientApplication) =>
  app.container.instance(
    authorizationClientToken,
    new AuthorizationClient(app.container.resolve(apiClientToken)),
  );
const catalog: AuthorizationOptionsResponse = {
  sections: [
    {
      name: 'business',
      title: 'Business',
      order: 1,
      subsections: [
        {
          name: 'jobs',
          title: 'Jobs',
          resources: [
            {
              type: 'composite',
              id: 'jobs',
              title: 'Jobs',
              actions: [
                { name: 'view', title: 'View' },
                { name: 'edit', title: 'Edit' },
              ],
              dataScopes: Object.fromEntries(
                ['view', 'edit'].map((action) => [
                  action,
                  [
                    {
                      key: 'jobs',
                      title: 'Jobs',
                      collection: 'jobs',
                      fields: ['name'],
                      recordAccess: ['allRecords', 'customFilter'],
                    },
                  ],
                ]),
              ),
            },
          ],
        },
      ],
    },
  ],
  recordAccess: [
    { key: 'allRecords', title: 'All records', collections: ['jobs'] },
    { key: 'customFilter', title: 'Custom filter', collections: ['jobs'] },
  ],
  subjectTypes: [
    {
      type: 'authenticated',
      title: 'Everyone',
      selection: { type: 'fixed', id: '*' },
    },
    { type: 'user', title: 'User', selection: { type: 'collection' } },
    { type: 'team', title: 'Team', selection: { type: 'collection' } },
  ],
  collections: [],
};
const existing: SharingRule = {
  key: 'handover',
  title: { key: 'sharingRules.title', ns: namespace },
  reason: 'Original reason',
  resource: { type: 'composite', id: 'jobs' },
  subjects: [
    { type: 'user', id: 'alice' },
    { type: 'team', id: 'machining' },
  ],
  actions: [
    {
      action: 'view',
      scopeKey: 'jobs',
      selection: { type: 'records', ids: ['job-1'] },
    },
    {
      action: 'edit',
      scopeKey: 'jobs',
      selection: {
        type: 'recordAccess',
        key: 'customFilter',
        params: { filter: { name: { $eq: 'Kept condition' } } },
      },
    },
  ],
};
function tree() {
  return (
    <Routes>
      <Route path='/sharing-rules' element={<Page />}>
        <Route path='create' element={<Form />} />
        <Route path=':key/edit' element={<Form />} />
      </Route>
    </Routes>
  );
}
type Request = { path: string; method?: string; json?: unknown };
function directory(request: Request): unknown {
  if (request.path === 'authorization/permissions')
    return { data: { unrestricted: true, permissions: [] } };
  if (request.path.endsWith('/options')) return { data: catalog };
  if (request.path.includes('/subjects/')) {
    const data = request.path.includes('/team')
      ? [{ id: 'machining', title: 'Machining team' }]
      : [
          { id: 'alice', title: 'Alice' },
          { id: 'bob', title: 'Bob' },
        ];
    return { data, meta: { total: data.length } };
  }
  if (request.path.includes('/records/'))
    return {
      data: [
        { id: 'job-1', label: 'Job one' },
        { id: 'job-2', label: 'Job two' },
      ],
      meta: { total: 2 },
    };
  return undefined;
}

it('edits recipients and reason while preserving other recipients, actions and nested filter parameters', async () => {
  const user = userEvent.setup();
  let saved: SharingRule | undefined;
  const calls = vi.fn((request: Request) => {
    const response = directory(request);
    if (response) return response;
    if (request.method === 'PATCH') {
      saved = request.json as SharingRule;
      return { data: { ...existing, ...saved } };
    }
    return { data: [existing] };
  });
  await renderSettingsClient(tree(), {
    route: '/sharing-rules/handover/edit',
    namespace,
    namespaces,
    services,
    fetch: answerApi(calls),
  });
  await user.click(await screen.findByRole('checkbox', { name: /^Bob/ }));
  const reason = screen.getByRole('textbox', { name: 'Reason for sharing' });
  await user.clear(reason);
  await user.type(reason, 'Updated reason');
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await waitFor(() => expect(saved).toBeDefined());
  expect(saved).toEqual({
    reason: 'Updated reason',
    subjects: [...existing.subjects, { type: 'user', id: 'bob' }],
  });
  expect(
    calls.mock.calls.filter(([request]) => request.method === 'PATCH'),
  ).toHaveLength(1);
});

it('retains an edited draft when the saved rule changed and never overwrites it', async () => {
  const user = userEvent.setup();
  let remote = existing;
  const calls = vi.fn(
    (request: Request) => directory(request) ?? { data: [remote] },
  );
  await renderSettingsClient(tree(), {
    route: '/sharing-rules/handover/edit',
    namespace,
    namespaces,
    services,
    fetch: answerApi(calls),
  });
  const reason = await screen.findByRole('textbox', {
    name: 'Reason for sharing',
  });
  await user.type(reason, ' private draft');
  remote = { ...existing, reason: 'Someone else changed this' };
  await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
  await screen.findByText(
    'This rule changed while you were editing. Reload the latest version before saving.',
  );
  expect(reason).toHaveValue('Original reason private draft');
  expect(calls.mock.calls.some(([request]) => request.method === 'PATCH')).toBe(
    false,
  );
});

it('does not offer global recipients or all-record sharing and preserves unavailable rules read-only', async () => {
  const user = userEvent.setup();
  const rule = {
    ...existing,
    actions: [
      ...existing.actions,
      {
        action: 'retired-action',
        selection: { type: 'records' as const, ids: ['legacy'] },
      },
    ],
  };
  const calls = vi.fn(
    (request: Request) => directory(request) ?? { data: [rule] },
  );
  await renderSettingsClient(tree(), {
    route: '/sharing-rules/handover/edit',
    namespace,
    namespaces,
    services,
    fetch: answerApi(calls),
  });
  await screen.findByText(
    'This rule contains unavailable operations or unsupported selections. It is shown read-only to preserve its configuration.',
  );
  expect(
    screen.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled();
  expect(
    screen.getByRole('textbox', { name: 'Reason for sharing' }),
  ).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
  await screen.findByRole('button', { name: 'New sharing rule', exact: true });
  expect(
    calls.mock.calls.some(([request]) =>
      ['PATCH', 'DELETE'].includes(request.method ?? ''),
    ),
  ).toBe(false);
});

it('rejects empty, unrestricted and all-record selections before submission', () => {
  expect(validSharingActions(existing)).toBe(true);
  for (const selection of [
    { type: 'all' },
    { type: 'records', ids: [] },
    { type: 'recordAccess', key: 'allRecords' },
  ] as const)
    expect(
      validSharingActions({
        ...existing,
        actions: [{ action: 'view', scopeKey: 'jobs', selection }],
      }),
    ).toBe(false);
  expect(validSharingActions({ ...existing, actions: [] })).toBe(false);
});
