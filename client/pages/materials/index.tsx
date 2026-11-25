import type { ReactElement } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Link, Outlet } from 'react-router';
import { Plus } from 'lucide-react';
import { resolveListState } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { DataTable, DataTableSearch } from '#components/data-table';
import { Button } from '#components/ui/button';
import { RecordLink } from '#components/record-link';
import { RowActions } from '#components/row-actions';
import { StatusBadge } from '#components/status-badge';
import { useListData } from '#hooks/use-list-data';
import { useListLocation } from '#hooks/use-list-location';
import {
  readTableUrlState,
  useTableUrlState,
} from '#hooks/use-table-url-state';
import type {
  Material,
  MaterialCategory,
} from '../../../shared/material-master-data.js';
import { CategoryTree } from './category-tree.js';
import { MaterialError } from './shared.js';
import type { MaterialPageContext } from './model.js';

export default function MaterialMasterDataPage(): ReactElement {
  const { t } = useTranslation();
  const { params, setParams, active } = useListLocation();
  const q = params.get('q') ?? '';
  const categoryId = params.get('categoryId') ?? '';
  const parsed = readTableUrlState(params, {
    defaultPageSize: 20,
    sortColumns: [],
  });
  const categories = useListData<{ data: MaterialCategory[] }>(
    'materialMaster/categories',
  );
  const query = new URLSearchParams({
    q,
    page: String(parsed.paginationState.pageIndex + 1),
    pageSize: String(parsed.paginationState.pageSize),
    ...(categoryId ? { categoryId } : {}),
  });
  const records = useListData<{ data: Material[]; meta: { total: number } }>(
    `materialMaster/materials?${query}`,
    { active },
  );
  const table = useTableUrlState({
    active,
    defaultPageSize: 20,
    sortColumns: [],
    rowCount: records.data?.meta.total,
    revision: records.revision,
  });
  const canCreate = useCan({
    resource: { type: 'composite', id: 'masterData.materials' },
    action: 'create',
  }).can;
  const canCreateCategory = useCan({
    resource: { type: 'composite', id: 'masterData.categories' },
    action: 'create',
  }).can;
  const change = (key: string, value: string) =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.delete('page');
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  const context: MaterialPageContext = {
    reload: () => {
      categories.reload();
      records.reload();
    },
    selectCategory: (id) => change('categoryId', id),
  };
  const categoryName = (id: string) =>
    categories.data?.data.find((category) => category.id === id)?.name ?? '—';
  const target = (material: Material) => ({
    pathname: `${encodeURIComponent(material.id)}/edit`,
    search: params.toString(),
  });
  const columns: ColumnDef<Material>[] = [
    {
      accessorKey: 'code',
      header: t('materials.code'),
      cell: ({ row }) => (
        <RecordLink to={target(row.original)}>{row.original.code}</RecordLink>
      ),
    },
    { accessorKey: 'name', header: t('materials.name') },
    { accessorKey: 'specification', header: t('materials.specification') },
    { accessorKey: 'drawingNumber', header: t('materials.drawingNumber') },
    {
      id: 'category',
      header: t('materials.categoryId'),
      cell: ({ row }) => categoryName(row.original.categoryId),
    },
    { accessorKey: 'unit', header: t('materials.unit') },
    {
      id: 'enabled',
      header: t('materials.enabled'),
      cell: ({ row }) => (
        <StatusBadge tone={row.original.enabled ? 'success' : 'neutral'}>
          {t(row.original.enabled ? 'materials.active' : 'materials.inactive')}
        </StatusBadge>
      ),
    },
    {
      id: 'actions',
      header: () => <span className='sr-only'>{t('settings.actions')}</span>,
      cell: ({ row }) => (
        <RowActions
          label={t('materials.actionsFor', { name: row.original.code })}
          actions={[
            {
              key: 'open',
              label: t('materials.open'),
              render: <Link to={target(row.original)} />,
            },
          ]}
        />
      ),
    },
  ];
  const error = table.error ?? categories.error ?? records.error;
  const listState = resolveListState(
    {
      data: error ? undefined : records.data?.data,
      error,
      isPending: !records.data && (records.loading || categories.loading),
    },
    records.data?.data.length ?? 0,
    Boolean(q || categoryId),
  );
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('materials.masterData')}
          description={t('materials.description')}
          actions={
            canCreate ? (
              <Button
                nativeButton={false}
                disabled={!categories.data?.data.length}
                render={
                  <Link
                    to={{ pathname: 'create', search: params.toString() }}
                  />
                }
              >
                <Plus />
                {t('materials.newMaterial')}
              </Button>
            ) : undefined
          }
        />
        <div className='grid min-w-0 gap-4 md:grid-cols-[17rem_minmax(0,1fr)]'>
          <div className='min-w-0'>
            <MaterialError error={categories.error} retry={categories.reload} />
            <CategoryTree
              categories={categories.data?.data ?? []}
              selected={categoryId}
              searchString={params.toString()}
              canCreate={canCreateCategory}
              onSelect={(id) => change('categoryId', id)}
            />
          </div>
          <section
            aria-label={t('materials.title')}
            className='grid min-w-0 content-start gap-4'
          >
            <p className='text-sm text-muted-foreground'>
              {t('materials.categoryStatus', {
                name: categoryId
                  ? categoryName(categoryId)
                  : t('materials.allCategories'),
              })}{' '}
              · {t('materials.categoryHint')}
            </p>
            <DataTable
              {...table}
              columns={columns}
              data={records.data?.data ?? []}
              getRowId={(row) => row.id}
              manualPagination
              rowCount={records.data?.meta.total}
              showSelectedCount={false}
              listState={listState}
              loading={active && records.loading}
              onRetry={context.reload}
              search={
                <DataTableSearch
                  value={q}
                  label={t('materials.search')}
                  onSearch={(value) => change('q', value)}
                />
              }
              summary={
                records.data
                  ? t('materials.resultCount', {
                      count: records.data.meta.total,
                    })
                  : undefined
              }
              onClearFilters={() =>
                setParams(new URLSearchParams(), { replace: true })
              }
              renderCard={(row, card) => (
                <article className='grid min-w-0 gap-3 rounded-lg border p-4'>
                  <div className='flex min-w-0 items-start justify-between gap-2'>
                    <RecordLink
                      to={target(row.original)}
                      className='min-w-0 break-words'
                    >
                      {row.original.code}
                    </RecordLink>
                    {card.actions}
                  </div>
                  <p className='font-medium break-words'>{row.original.name}</p>
                  <p className='text-sm break-words text-muted-foreground'>
                    {row.original.specification || '—'} · {row.original.unit}
                  </p>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='min-w-0 text-sm break-words'>
                      {categoryName(row.original.categoryId)}
                    </span>
                    <StatusBadge
                      tone={row.original.enabled ? 'success' : 'neutral'}
                    >
                      {t(
                        row.original.enabled
                          ? 'materials.active'
                          : 'materials.inactive',
                      )}
                    </StatusBadge>
                  </div>
                </article>
              )}
            />
          </section>
        </div>
      </PageContainer>
      <Outlet context={context} />
    </>
  );
}
