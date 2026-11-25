import type { ReactElement } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useTranslation } from '@nocobase/i18n/client';
import { useListData } from '#hooks/use-list-data';
import {
  useTableUrlState,
  readTableUrlState,
} from '#hooks/use-table-url-state';
import { DataTable } from '#components/data-table';
import { RecordLink } from '#components/record-link';
import { RowActions } from '#components/row-actions';
import { Link } from 'react-router';
import { resolveListState } from '@nocobase/app-client';
import type {
  Material,
  MaterialCategory,
} from '../../../../shared/material-master-data.js';

export function CategoryMaterials({
  id,
  params,
  active,
}: {
  id: string;
  params: URLSearchParams;
  active: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const paging = readTableUrlState(params, {
    defaultPageSize: 20,
    sortColumns: [],
  });
  const rows = useListData<{ data: Material[]; meta: { total: number } }>(
    `materialMaster/materials?categoryId=${encodeURIComponent(id)}&page=${paging.paginationState.pageIndex + 1}&pageSize=${paging.paginationState.pageSize}`,
    { active },
  );
  const table = useTableUrlState({
    defaultPageSize: 20,
    sortColumns: [],
    rowCount: rows.data?.meta.total,
    active,
    revision: rows.revision,
  });
  const link = (row: Material) => ({
    pathname: `materials/${row.id}`,
    search: `?${params.toString()}`,
  });
  const columns: ColumnDef<Material>[] = [
    {
      accessorKey: 'code',
      header: t('materials.code'),
      cell: ({ row }) => (
        <RecordLink to={link(row.original)}>{row.original.code}</RecordLink>
      ),
    },
    { accessorKey: 'name', header: t('materials.name') },
    { accessorKey: 'specification', header: t('materials.specification') },
    { accessorKey: 'unit', header: t('materials.unit') },
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
              render: <Link to={link(row.original)} />,
            },
          ]}
        />
      ),
    },
  ];
  return (
    <DataTable
      {...table}
      columns={columns}
      data={rows.data?.data ?? []}
      manualPagination
      rowCount={rows.data?.meta.total}
      showSelectedCount={false}
      getRowId={(row) => row.id}
      loading={active && rows.loading}
      listState={resolveListState(
        {
          data: rows.data?.data,
          error: rows.error,
          isPending: !rows.data && rows.loading,
        },
        rows.data?.data.length ?? 0,
        false,
      )}
      onRetry={rows.reload}
      renderCard={(row, card) => (
        <article className='grid gap-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between gap-2'>
            <RecordLink to={link(row.original)}>{row.original.code}</RecordLink>
            {card.actions}
          </div>
          <p className='break-words'>{row.original.name}</p>
          <p className='text-sm break-words text-muted-foreground'>
            {row.original.specification || '—'} · {row.original.unit}
          </p>
        </article>
      )}
    />
  );
}

export function CategoryChildren({
  rows,
  select,
}: {
  rows: readonly MaterialCategory[];
  select: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const target = (id: string) => `?${new URLSearchParams({ selected: id })}`;
  const columns: ColumnDef<MaterialCategory>[] = [
    {
      accessorKey: 'name',
      header: t('categoryManagement.name'),
      cell: ({ row }) => (
        <RecordLink
          to={target(row.original.id)}
          onClick={(event) => {
            event.preventDefault();
            select(row.original.id);
          }}
        >
          {row.original.name}
        </RecordLink>
      ),
    },
    { accessorKey: 'code', header: t('categoryManagement.code') },
    {
      id: 'actions',
      header: () => <span className='sr-only'>{t('settings.actions')}</span>,
      cell: ({ row }) => (
        <RowActions
          label={t('materials.actionsFor', { name: row.original.name })}
          actions={[
            {
              key: 'open',
              label: t('materials.open'),
              render: (
                <Link
                  to={target(row.original.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    select(row.original.id);
                  }}
                />
              ),
            },
          ]}
        />
      ),
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={[...rows]}
      getRowId={(row) => row.id}
      showSelectedCount={false}
      pageSize={10}
      renderCard={(row, card) => (
        <article className='grid gap-2 rounded-lg border p-4'>
          <div className='flex items-center justify-between gap-2'>
            <RecordLink
              to={target(row.original.id)}
              onClick={(event) => {
                event.preventDefault();
                select(row.original.id);
              }}
            >
              {row.original.name}
            </RecordLink>
            {card.actions}
          </div>
          <p className='text-sm text-muted-foreground'>{row.original.code}</p>
        </article>
      )}
    />
  );
}
