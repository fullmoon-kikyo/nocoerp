import { useListLocation } from '#hooks/use-list-location';
import { RecordLink } from '#components/record-link';
import { useTableUrlState } from '#hooks/use-table-url-state';
import {
  ApiClientError,
  resolveListState,
  useApiClient,
  useSubmission,
  useToaster,
} from '@nocobase/app-client';
import {
  useCan,
  type AuthorizationOptionsResponse,
  type LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { PlusIcon } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Alert, AlertDescription } from '#components/ui/alert';
import { PermissionManagementPage } from './permission-management-page.js';
import { DataTable, DataTableColumnHeader } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Spinner } from '#components/ui/spinner';
import { Input } from '#components/ui/input';
import { RowActions } from '#components/row-actions';
import { ConfirmAction, SettingsError } from './shared.js';
import { useSettingsData } from './hooks.js';
import {
  actionKey,
  resourceKey,
  ruleResources,
  ruleScopes,
} from './default-access-model.js';
import { type SharingRule } from './sharing-rules-model.js';

export default function SharingRulesPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const location = useLocation();
  const { params, setParams, active } = useListLocation();
  const search = params.get('q') ?? '';
  const searchRef = useRef<HTMLInputElement>(null);
  const rules = useSettingsData<{ data: readonly SharingRule[] }>(
    'authorization/sharingRules',
    { active },
  );
  const catalog = useSettingsData<{ data: AuthorizationOptionsResponse }>(
    'authorization/sharingRules/options',
  );
  const createPermission = useCan({
    resource: { type: 'settings', id: 'authorization.sharing-rules' },
    action: 'create',
  });
  const canCreate = createPermission.can && !createPermission.isPending;
  const canDelete = useCan({
    resource: { type: 'settings', id: 'authorization.sharing-rules' },
    action: 'delete',
  }).can;
  const [removing, setRemoving] = useState<SharingRule>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [conflict, setConflict] = useState(false);
  const text = (value: LocalizedText): string =>
    typeof value === 'string'
      ? value
      : t(value.key, {
          ns: value.ns,
          defaultValue: value.defaultValue ?? value.key,
        });
  const resources = catalog.data ? ruleResources(catalog.data.data) : [];
  const name = (rule: SharingRule): string =>
    text(
      resources.find(
        (resource) => resourceKey(resource) === resourceKey(rule.resource),
      )?.title ?? rule.resource.id,
    );
  const displayName = (rule: SharingRule): string =>
    rule.title ? text(rule.title) : rule.key;
  const summary = (rule: SharingRule): string => {
    const resource = resources.find(
      (resource) => resourceKey(resource) === resourceKey(rule.resource),
    );
    const scopes = catalog.data ? ruleScopes(resource, catalog.data.data) : [];
    return (
      rule.actions
        .map((entry) => {
          const scope = scopes.find((scope) => scope.id === actionKey(entry));
          const label =
            entry.selection.type === 'all'
              ? t('sharingRules.all')
              : entry.selection.type === 'records'
                ? t('sharingRules.records', {
                    count: entry.selection.ids.length,
                  })
                : text(
                    catalog.data?.data.recordAccess.find(
                      (item) =>
                        entry.selection.type === 'recordAccess' &&
                        item.key === entry.selection.key,
                    )?.title ?? entry.selection.key,
                  );
          return `${text(scope?.actionTitle ?? entry.action)}${scope ? ` · ${text(scope.title)}` : entry.scopeKey ? ` · ${entry.scopeKey}` : ''}: ${label}`;
        })
        .join('; ') || t('sharingRules.none')
    );
  };
  const columns: ColumnDef<SharingRule>[] = [
    {
      id: 'title',
      header: t('sharingRules.name'),
      enableSorting: false,
      cell: ({ row }) => (
        <RecordLink
          to={{
            pathname: `${encodeURIComponent(row.original.key)}/edit`,
            search: location.search,
          }}
        >
          {row.original.title ? text(row.original.title) : row.original.key}
        </RecordLink>
      ),
    },
    {
      id: 'recipients',
      header: t('sharingRules.recipients'),
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className='block max-w-64 truncate'
          title={row.original.subjects
            .map((subject) => `${subject.type}: ${subject.id}`)
            .join('; ')}
        >
          {t('sharingRules.recipientCount', {
            count: row.original.subjects.length,
          })}
        </span>
      ),
    },
    {
      id: 'resource',
      accessorFn: name,
      sortingFn: (a, b) =>
        name(a.original).localeCompare(name(b.original), i18n.language),
      header: ({ column }) => (
        <DataTableColumnHeader
          column={column}
          title={t('sharingRules.resource')}
        />
      ),
      cell: ({ row }) => (
        <RecordLink
          to={{
            pathname: `${encodeURIComponent(row.original.key)}/edit`,
            search: location.search,
          }}
        >
          {name(row.original)}
        </RecordLink>
      ),
    },
    {
      accessorKey: 'key',
      header: t('settings.key'),
      enableSorting: false,
      cell: ({ row }) => (
        <span
          className='block max-w-48 truncate text-muted-foreground'
          title={row.original.key}
        >
          {row.original.key}
        </span>
      ),
    },
    {
      id: 'scopes',
      header: t('sharingRules.scopes'),
      enableSorting: false,
      cell: ({ row }) => (
        <span className='block max-w-96 truncate' title={summary(row.original)}>
          {summary(row.original)}
        </span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => <span className='sr-only'>{t('settings.actions')}</span>,
      cell: ({ row }) => (
        <RowActions
          label={t('settings.actionsFor', { name: displayName(row.original) })}
          actions={[
            {
              key: 'open',
              label: t('sharingRules.open'),
              render: (
                <Link
                  to={{
                    pathname: `${encodeURIComponent(row.original.key)}/edit`,
                    search: location.search,
                  }}
                />
              ),
            },
            canDelete && {
              key: 'delete',
              label: t('sharingRules.delete'),
              destructive: true,
              onClick: () => {
                setError(undefined);
                setRemoving(row.original);
              },
            },
          ]}
        />
      ),
    },
  ];
  const rows = (rules.data?.data ?? [])
    .filter((rule) =>
      `${name(rule)} ${rule.key} ${rule.title ? text(rule.title) : ''} ${rule.subjects.map((subject) => `${subject.type}:${subject.id}`).join(' ')}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase()),
    )
    .sort((a, b) => name(a).localeCompare(name(b), i18n.language));
  const tableState = useTableUrlState({
    active,
    revision: rules.revision,
    defaultPageSize: 20,
    sortColumns: ['resource'],
    rowCount:
      rules.data &&
      !rules.loading &&
      !rules.error &&
      catalog.data &&
      !catalog.loading &&
      !catalog.error
        ? rows.length
        : undefined,
  });
  const listError =
    [rules.error, catalog.error].find(
      (error) =>
        error instanceof ApiClientError && [401, 403].includes(error.status),
    ) ??
    tableState.error ??
    rules.error ??
    catalog.error;
  const listData = rules.data && catalog.data ? rows : undefined;
  const listState = resolveListState(
    {
      data: listData,
      error: listError,
      isPending: !listData && (rules.loading || catalog.loading),
    },
    rows.length,
    Boolean(search.trim()),
  );
  const canShowCreate =
    canCreate &&
    (listState === 'empty' ||
      listState === 'ready' ||
      listState === 'no-results' ||
      listState === 'refresh-failed');
  const clearSearch = () =>
    setParams(
      (old) => {
        const next = new URLSearchParams(old);
        next.delete('q');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  const eligible = resources.some(
    (resource) =>
      catalog.data && ruleScopes(resource, catalog.data.data).length > 0,
  );
  const create =
    canCreate && rules.data && catalog.data ? (
      eligible ? (
        <Button
          nativeButton={false}
          render={<Link to={{ pathname: 'create', search: location.search }} />}
        >
          <PlusIcon />
          {t('sharingRules.new')}
        </Button>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-sm text-muted-foreground'>
            {t('sharingRules.noResourcesShort')}
          </span>
          <Button disabled>
            <PlusIcon />
            {t('sharingRules.new')}
          </Button>
        </div>
      )
    ) : null;
  const submission = useSubmission();
  const remove = async () => {
    if (!removing || busy || !canDelete) return;
    setBusy(true);
    setError(undefined);
    let submitted = false;
    try {
      const outcome = await submission.run(
        { key: removing.key },
        async (idempotencyKey, _signal, _snapshot, recovering) => {
          if (!recovering) {
            const latest = await api.request<{
              data: readonly SharingRule[];
            }>({ path: 'authorization/sharingRules' });
            if (
              JSON.stringify(
                latest.data.find((rule) => rule.key === removing.key),
              ) !== JSON.stringify(removing)
            ) {
              rules.reload();
              setRemoving(undefined);
              setConflict(true);
              requestAnimationFrame(() => searchRef.current?.focus());
              return undefined;
            }
          }
          submitted = true;
          await api.request({
            path: `authorization/sharingRules/${encodeURIComponent(removing.key)}`,
            method: 'DELETE',
            headers: { 'Idempotency-Key': idempotencyKey },
          });
          return true;
        },
      );
      if (!outcome) return;
      toaster.show({
        type: 'success',
        title: t('sharingRules.deleted', { name: displayName(removing) }),
      });
      setRemoving(undefined);
      rules.reload();
      requestAnimationFrame(() => searchRef.current?.focus());
    } catch (next) {
      setError(next);
      if (
        submitted &&
        (!(next instanceof ApiClientError) || next.status >= 500)
      ) {
        // The write may have committed before the response was lost. Verify without replaying it.
        rules.reload();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PermissionManagementPage
        tab='sharing-rules'
        actions={canShowCreate ? create : undefined}
      >
        <p className='text-sm text-muted-foreground'>
          {t('sharingRules.boundary')}
        </p>
        {rules.data && catalog.data && !eligible && (
          <p
            role='status'
            className='rounded-lg border p-4 text-sm text-muted-foreground'
          >
            {t('sharingRules.noResources')}
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            ref={searchRef}
            className='sm:max-w-xs'
            value={search}
            placeholder={t('sharingRules.search')}
            aria-label={t('sharingRules.search')}
            onChange={(event) =>
              setParams(
                (old) => {
                  const next = new URLSearchParams(old);
                  next.delete('page');
                  if (event.target.value) next.set('q', event.target.value);
                  else next.delete('q');
                  return next;
                },
                { replace: true },
              )
            }
          />
          {search && listState !== 'no-results' && (
            <Button variant='ghost' onClick={clearSearch}>
              {t('settings.clear')}
            </Button>
          )}
          {active &&
          (rules.loading || catalog.loading) &&
          (rules.data || catalog.data) ? (
            <Spinner className='text-muted-foreground' />
          ) : null}
        </div>
        {conflict && (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('sharingRules.deleteChanged')}
            </AlertDescription>
          </Alert>
        )}
        <SettingsError error={!removing && error} />
        <DataTable
          {...tableState}
          columns={columns}
          data={rows}
          getRowId={(rule) => rule.key}
          getColumnLabel={() => t('sharingRules.resource')}
          renderCard={(row, card) => (
            <article className='grid min-w-0 gap-3 rounded-lg border p-4'>
              <div className='flex min-w-0 items-start justify-between gap-2'>
                <RecordLink
                  className='min-w-0 break-words'
                  to={{
                    pathname: `${encodeURIComponent(row.original.key)}/edit`,
                    search: location.search,
                  }}
                >
                  {displayName(row.original)}
                </RecordLink>
                {card.actions}
              </div>
              <dl className='grid min-w-0 gap-2 text-sm'>
                <div className='grid grid-cols-[auto_1fr] gap-3'>
                  <dt className='text-muted-foreground'>
                    {t('sharingRules.resource')}
                  </dt>
                  <dd className='min-w-0 break-words'>{name(row.original)}</dd>
                </div>
                <div className='grid grid-cols-[auto_1fr] gap-3'>
                  <dt className='text-muted-foreground'>
                    {t('sharingRules.recipients')}
                  </dt>
                  <dd>
                    {t('sharingRules.recipientCount', {
                      count: row.original.subjects.length,
                    })}
                  </dd>
                </div>
              </dl>
              <p className='line-clamp-3 text-sm break-words text-muted-foreground'>
                {summary(row.original)}
              </p>
            </article>
          )}
          showSelectedCount={false}
          pageSize={20}
          loading={active && (rules.loading || catalog.loading)}
          listState={listState}
          onRetry={() => {
            rules.reload();
            catalog.reload();
          }}
          onClearFilters={clearSearch}
        />
        <ConfirmAction
          error={<SettingsError error={error} />}
          open={Boolean(removing)}
          title={t('sharingRules.deleteTitle', {
            name: removing ? displayName(removing) : '',
          })}
          description={t('sharingRules.deleteHint')}
          confirmLabel={t('sharingRules.delete')}
          busy={busy}
          onCancel={() => {
            setRemoving(undefined);
            setError(undefined);
          }}
          onConfirm={() => {
            void remove();
          }}
        />
      </PermissionManagementPage>
      <Outlet
        context={{
          reload: rules.reload,
          saved: (updated: SharingRule) => {
            rules.replaceData({
              data: [
                ...(rules.data?.data ?? []).filter(
                  (rule) => rule.key !== updated.key,
                ),
                updated,
              ],
            });
            rules.reload();
          },
        }}
      />
    </>
  );
}
