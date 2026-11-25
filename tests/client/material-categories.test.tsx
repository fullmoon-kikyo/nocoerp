import { useState } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { renderSettingsClient } from '../helpers/settings-client.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import { CategoryTree } from '../../client/pages/materials/category-tree.js';
import type { MaterialCategory } from '../../shared/material-master-data.js';

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(() => vi.unstubAllGlobals());

const categories: MaterialCategory[] = [
  { id: 'root', code: 'RAW', name: 'Raw materials', parentId: null },
  { id: 'steel', code: 'STEEL', name: 'Die steel', parentId: 'root' },
  { id: 'copper', code: 'COPPER', name: 'Copper', parentId: 'root' },
  {
    id: 'readable-child',
    code: 'OTHER',
    name: 'Readable category',
    parentId: 'unreadable-parent',
  },
].map((category) => ({
  ...category,
  version: 1,
  sortOrder: 0,
  description: '',
  createdAt: '',
  updatedAt: '',
  createdById: '',
  updatedById: '',
}));
const namespace = 'material-categories-test';
const namespaces = {
  [namespace]: {
    'en-US': async () => ({ default: enUS }),
    'zh-CN': async () => ({ default: zhCN }),
  },
};
function Host() {
  const [selected, setSelected] = useState('');
  return (
    <CategoryTree
      categories={categories}
      selected={selected}
      onSelect={setSelected}
      searchString=''
      canCreate
    />
  );
}

it('retains ancestors during category searches and keeps readable categories whose parent is unavailable', async () => {
  const user = userEvent.setup();
  await renderSettingsClient(<Host />, {
    route: '/materials/master-data',
    namespace,
    namespaces,
  });
  expect(
    screen.getByRole('button', { name: 'Readable category', exact: true }),
  ).toBeVisible();
  await user.type(
    screen.getByRole('textbox', { name: 'Search categories' }),
    'STEEL',
  );
  expect(
    screen.getByRole('button', { name: 'Raw materials', exact: true }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Copper', exact: true }),
  ).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  );
  expect(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
});

it('supports collapsing branches and clearing the selected category without discarding tree state', async () => {
  const user = userEvent.setup();
  await renderSettingsClient(<Host />, {
    route: '/materials/master-data',
    namespace,
    namespaces,
  });
  await user.click(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  );
  await user.click(
    screen.getByRole('button', { name: 'Collapse Raw materials' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Die steel', exact: true }),
  ).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'All categories', exact: true }),
  );
  expect(
    screen.getByRole('button', { name: 'All categories', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await user.click(
    screen.getByRole('button', { name: 'Expand Raw materials' }),
  );
  expect(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  ).toBeVisible();
});

it('the adapted ITAM tree keeps selection and provides named branch controls', async () => {
  const { TreeView } =
    await import('../../client/pages/materials/categories/tree-view.js');
  const user = userEvent.setup();
  const select = vi.fn();
  await renderSettingsClient(
    <TreeView
      nodes={categories.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        label: row.name,
      }))}
      selectedId='steel'
      onSelect={select}
    />,
    { route: '/materials/categories', namespace, namespaces },
  );
  expect(
    screen.getByRole('button', { name: 'Die steel', exact: true }),
  ).toHaveAttribute('aria-current', 'true');
  await user.click(
    screen.getByRole('button', { name: 'Collapse Raw materials', exact: true }),
  );
  expect(
    screen.queryByRole('button', { name: 'Die steel', exact: true }),
  ).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Expand Raw materials', exact: true }),
  );
  await user.click(screen.getByRole('button', { name: 'Copper', exact: true }));
  expect(select).toHaveBeenCalledWith('copper');
});
