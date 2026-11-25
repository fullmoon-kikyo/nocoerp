// Layout adapted from NocoITAM TreePanes / DetailPage, commit 30c9851 (Apache-2.0).
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, Outlet } from 'react-router';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  Upload,
  Filter,
  Plus,
  Trash2,
  History,
  Boxes,
  ListTree,
  FolderTree,
} from 'lucide-react';
import {
  ApiClientError,
  resolveListState,
  resolveAppUrl,
  useApiClient,
  useSubmission,
  useToaster,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Badge } from '#components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '#components/ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '#components/ui/popover';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#components/ui/collapsible';
import { PendingButton } from '#components/pending-button';
import { RefreshIndicator } from '#components/loading';
import { ListFeedback, ListFeedbackActions } from '#components/list-feedback';
import { RowActions } from '#components/row-actions';
import { DataTableSearch } from '#components/data-table';
import { useListData } from '#hooks/use-list-data';
import { useListLocation } from '#hooks/use-list-location';
import { ConfirmAction } from '../../settings/shared.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';
import { categoryTree } from '../model.js';
import { TreeView, type TreeMove } from './tree-view.js';
import { CategoryError, type CategoryPageContext } from './shared.js';
import {
  categoryPath,
  downloadCategoryCsv,
  useCategoryPermission,
} from './model.js';
import { InlineCategoryField } from './inline-field.js';
import { CategoryChildren, CategoryMaterials } from './related.js';
import { CategoryHistory } from './history.js';

function ToolButton({
  label,
  children,
  onClick,
  disabled = false,
  busy = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
}): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <PendingButton
            busy={busy}
            variant='outline'
            size={busy ? 'default' : 'icon'}
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
          >
            {children}
          </PendingButton>
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function MaterialCategoriesPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { session } = useAuthentication();
  const { params, setParams, active } = useListLocation();
  const categories = useListData<{ data: MaterialCategory[] }>(
    'materialMaster/categories',
    { active },
  );
  const rows = categories.data?.data ?? [];
  const listState = resolveListState(
    {
      data: categories.data?.data,
      error: categories.error,
      isPending: !categories.data && categories.loading,
    },
    rows.length,
  );
  const listAvailable = [
    'ready',
    'empty',
    'no-results',
    'refresh-failed',
  ].includes(listState);
  const [revision, setRevision] = useState(0);
  const { reload: reloadCategories } = categories;
  const reload = useCallback(() => {
    reloadCategories();
    setRevision((value) => value + 1);
  }, [reloadCategories]);
  const explicit = params.get('selected');
  const first = rows.find((row) => !row.parentId) ?? rows[0];
  const id = explicit ?? first?.id ?? '';
  const selected = rows.find((row) => row.id === id);
  const tab = ['history', 'materials', 'children'].includes(
    params.get('tab') ?? '',
  )
    ? params.get('tab')!
    : 'history';
  const q = params.get('q') ?? '';
  const set = (changes: Record<string, string | undefined>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: true },
    );
  const select = (selectedId: string) =>
    set({ selected: selectedId, page: undefined, historyPage: undefined });
  const context: CategoryPageContext = {
    categories: rows,
    reload,
    selectCategory: select,
    categorySelectionParam: 'selected',
  };
  const canCreate = useCategoryPermission('create');
  const canEdit = useCategoryPermission('edit');
  const canMove = useCategoryPermission('move');
  const canDelete = useCategoryPermission('delete');
  const canImport = useCategoryPermission('import');
  const canExport = useCategoryPermission('export');
  const canComment = useCategoryPermission('comment');
  const canViewMaterials = useCan({
    resource: { type: 'composite', id: 'masterData.materials' },
    action: 'view',
  }).can;
  const materialCount = useListData<{
    data: unknown[];
    meta: { total: number };
  }>(
    `materialMaster/materials?categoryId=${encodeURIComponent(id)}&pageSize=1`,
    { active: active && Boolean(selected) && canViewMaterials },
  );
  const [expanded, setExpanded] = useState(true);
  const [treeOpen, setTreeOpen] = useState(false);
  const [error, setError] = useState<unknown>();
  const [removing, setRemoving] = useState<MaterialCategory>();
  const [exporting, setExporting] = useState(false);
  const exportControllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => exportControllerRef.current?.abort(), []);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moveSubmission = useSubmission({
    scope: `${session?.user.id}:categories:tree-move`,
  });
  const deleteSubmission = useSubmission({
    scope: `${session?.user.id}:categories:delete:${removing?.id ?? ''}`,
  });
  const filtered = categoryTree(rows, q);
  const visible = [...filtered.values()].flat();
  const modalLink = (
    pathname: string,
    extras: Record<string, string | undefined> = {},
  ) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(extras))
      if (value) next.set(key, value);
      else next.delete(key);
    return { pathname, search: next.toString() };
  };
  const move = async (input: TreeMove) => {
    const row = rows.find((row) => row.id === input.id);
    if (!row || !canMove) return;
    setError(undefined);
    try {
      const result = await moveSubmission.run(
        { ...input, expectedVersion: row.version },
        (key, signal, snapshot) =>
          api.request({
            path: `materialMaster/categories/${snapshot.id}/move`,
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
            json: {
              parentId: snapshot.parentId,
              index: snapshot.index,
              expectedVersion: snapshot.expectedVersion,
            },
          }),
      );
      if (result) {
        reload();
        toaster.show({
          type: 'success',
          title: t('categoryManagement.movedToast', { name: row.name }),
        });
      }
    } catch (next) {
      setError(next);
    }
  };
  const remove = async () => {
    if (!removing || !canDelete) return;
    setError(undefined);
    try {
      const result = await deleteSubmission.run(
        removing,
        (key, signal, snapshot) =>
          api.request({
            path: `materialMaster/categories/${snapshot.id}`,
            method: 'DELETE',
            headers: { 'Idempotency-Key': key },
            signal,
            json: { expectedVersion: snapshot.version },
          }),
      );
      if (result) {
        const nextId =
          removing.parentId ?? rows.find((row) => row.id !== removing.id)?.id;
        categories.replaceData({
          data: rows.filter((row) => row.id !== removing.id),
        });
        setRemoving(undefined);
        set({ selected: nextId, page: undefined, historyPage: undefined });
        reload();
        toaster.show({
          type: 'success',
          title: t('categoryManagement.deletedToast', { name: removing.name }),
        });
        requestAnimationFrame(() => titleRef.current?.focus());
      }
    } catch (next) {
      setError(next);
    }
  };
  const exportCsv = async () => {
    if (exporting || !canExport) return;
    setExporting(true);
    setError(undefined);
    const controller = new AbortController();
    exportControllerRef.current = controller;
    try {
      const response = await fetch(
        resolveAppUrl(
          `/api/materialMaster/categories/export?${new URLSearchParams({ q })}`,
        ),
        { credentials: 'same-origin', signal: controller.signal },
      );
      if (!response.ok) {
        const payload: unknown = await response.json();
        const detail: unknown =
          payload && typeof payload === 'object'
            ? Reflect.get(payload, 'error')
            : undefined;
        const reason: unknown =
          detail && typeof detail === 'object'
            ? Reflect.get(detail, 'reason')
            : undefined;
        throw new ApiClientError('Export failed.', {
          status: response.status,
          reason: typeof reason === 'string' ? reason : undefined,
          method: 'GET',
          url: response.url,
          payload,
        });
      }
      downloadCategoryCsv(await response.blob(), 'material-categories.csv');
      toaster.show({
        type: 'success',
        title: t('categoryManagement.exportDone'),
      });
    } catch (next) {
      if (!controller.signal.aborted) setError(next);
    } finally {
      setExporting(false);
    }
  };
  const childRows = rows.filter((row) => row.parentId === id);
  const date = (value: string) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf())
      ? '—'
      : new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(parsed);
  };
  const detailsMenu = selected ? (
    <RowActions
      label={t('categoryManagement.actions')}
      actions={[
        canEdit && {
          key: 'edit',
          label: t('categoryManagement.edit'),
          render: <Link to={modalLink(`${id}/edit`)} />,
        },
        canMove && {
          key: 'move',
          label: t('categoryManagement.move'),
          render: <Link to={modalLink(`${id}/move`)} />,
        },
        canDelete && {
          key: 'delete',
          label: t('categoryManagement.remove'),
          destructive: true,
          onClick: () => {
            setError(undefined);
            setRemoving(selected);
          },
        },
      ]}
    />
  ) : null;
  const tree = (
    <TreeView
      key={expanded ? 'expanded' : 'collapsed'}
      nodes={visible.map((row) => ({
        id: row.id,
        parentId: row.parentId,
        label: row.name,
        sort: row.sortOrder,
      }))}
      defaultCollapsed={!expanded}
      selectedId={id}
      onSelect={select}
      onMove={
        canMove && !q && !moveSubmission.submitting
          ? (input) => {
              void move(input);
            }
          : undefined
      }
      rowActions={
        canDelete
          ? (nodeId) => (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={t('categoryManagement.deleteTitle', {
                        name: rows.find((row) => row.id === nodeId)?.name,
                      })}
                      className='size-8 min-h-[32px] min-w-[32px] text-muted-foreground opacity-100 group-hover/tree-row:opacity-100 hover:text-destructive md:size-5 md:min-h-0 md:min-w-0 md:opacity-0 md:group-data-selected/tree-row:opacity-100 md:group-focus-within/tree-row:opacity-100'
                      onClick={() => {
                        setError(undefined);
                        setRemoving(rows.find((row) => row.id === nodeId));
                      }}
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>
                  {t('categoryManagement.remove')}
                </TooltipContent>
              </Tooltip>
            )
          : undefined
      }
    />
  );
  return (
    <>
      <PageContainer className='flex min-h-[calc(100dvh-3.5rem)] flex-col gap-5 space-y-0 bg-background p-4 sm:p-5 md:h-[calc(100dvh-3.5rem)] md:min-h-0 md:p-5'>
        <PageHeader
          title={
            <span className='flex items-center gap-2'>
              {t('categoryManagement.title')}
              <Badge
                variant='outline'
                className='rounded-full border-0 px-1.5 text-xs font-normal text-muted-foreground'
              >
                {listAvailable && categories.data ? rows.length : '—'}
              </Badge>
            </span>
          }
          actions={
            <>
              <ListFeedbackActions
                state={listState}
                onRetry={categories.reload}
                busy={active && categories.loading}
                onClear={() => set({ q: undefined })}
                filtered={Boolean(q)}
              />
              {listAvailable && (
                <>
                  <Popover>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <PopoverTrigger
                            render={
                              <Button
                                variant='outline'
                                size='icon'
                                aria-label={t('categoryManagement.search')}
                              />
                            }
                          />
                        }
                      >
                        <Filter className={q ? 'text-primary' : ''} />
                      </TooltipTrigger>
                      <TooltipContent>
                        {t('categoryManagement.search')}
                      </TooltipContent>
                    </Tooltip>
                    <PopoverContent className='w-80 max-w-[calc(100vw-2rem)]'>
                      <DataTableSearch
                        value={q}
                        label={t('categoryManagement.search')}
                        onSearch={(value) => set({ q: value || undefined })}
                      />
                      {q && (
                        <Button
                          variant='ghost'
                          onClick={() => set({ q: undefined })}
                        >
                          {t('categoryManagement.clear')}
                        </Button>
                      )}
                    </PopoverContent>
                  </Popover>
                  <div className='hidden items-center gap-2 md:flex'>
                    {canExport && (
                      <ToolButton
                        label={t('categoryManagement.export')}
                        busy={exporting}
                        onClick={() => {
                          void exportCsv();
                        }}
                      >
                        <Download />
                      </ToolButton>
                    )}
                    {canImport && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              nativeButton={false}
                              variant='outline'
                              size='icon'
                              aria-label={t('categoryManagement.import')}
                              render={<Link to={modalLink('import')} />}
                            />
                          }
                        >
                          <Upload />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t('categoryManagement.import')}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                  <Button
                    variant='outline'
                    className='hidden md:inline-flex'
                    onClick={() => setExpanded((value) => !value)}
                  >
                    {expanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
                    {t(
                      expanded
                        ? 'categoryManagement.collapseAll'
                        : 'categoryManagement.expandAll',
                    )}
                  </Button>
                  <div className='md:hidden'>
                    {exporting ? (
                      <ToolButton
                        label={t('categoryManagement.export')}
                        busy
                        onClick={() => {
                          void exportCsv();
                        }}
                      >
                        <Download />
                      </ToolButton>
                    ) : (
                      <RowActions
                        label={t('categoryManagement.more')}
                        actions={[
                          {
                            key: 'collapse',
                            label: t(
                              expanded
                                ? 'categoryManagement.collapseAll'
                                : 'categoryManagement.expandAll',
                            ),
                            onClick: () => setExpanded((value) => !value),
                          },
                          canExport && {
                            key: 'export',
                            label: t('categoryManagement.export'),
                            disabled: exporting,
                            onClick: () => {
                              void exportCsv();
                            },
                          },
                          canImport && {
                            key: 'import',
                            label: t('categoryManagement.import'),
                            render: <Link to={modalLink('import')} />,
                          },
                        ]}
                      />
                    )}
                  </div>
                  {canCreate && (
                    <Button
                      nativeButton={false}
                      render={
                        <Link
                          to={modalLink('create', { parentId: undefined })}
                        />
                      }
                    >
                      <Plus />
                      {t('categoryManagement.create')}
                    </Button>
                  )}
                </>
              )}
            </>
          }
        />
        {!removing && <CategoryError error={error} retry={reload} />}
        <ListFeedback state={listState} identity='category-tree'>
          <div className='relative grid min-h-80 min-w-0 flex-1 gap-4 md:min-h-0 md:grid-cols-[minmax(13rem,17rem)_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]'>
            <RefreshIndicator
              pending={active && categories.loading && Boolean(categories.data)}
              identity='category-tree'
            />
            <aside
              className='min-h-0 min-w-0 md:overflow-y-auto'
              aria-label={t('categoryManagement.tree')}
            >
              <div className='grid gap-3 md:hidden'>
                <Select
                  value={id}
                  items={rows.map((row) => ({
                    value: row.id,
                    label: categoryPath(row, rows),
                  }))}
                  onValueChange={(value) => {
                    if (value) select(value);
                  }}
                >
                  <SelectTrigger
                    className='w-full'
                    aria-label={t('categoryManagement.selectedPath')}
                  >
                    <SelectValue placeholder={t('categoryManagement.choose')} />
                  </SelectTrigger>
                  <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                    {rows.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {categoryPath(row, rows)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Collapsible open={treeOpen} onOpenChange={setTreeOpen}>
                  <CollapsibleTrigger
                    render={
                      <Button
                        variant='outline'
                        className='w-full justify-start'
                      />
                    }
                  >
                    <FolderTree />
                    {t('categoryManagement.tree')}
                  </CollapsibleTrigger>
                  <CollapsibleContent className='pt-2'>
                    {tree}
                  </CollapsibleContent>
                </Collapsible>
              </div>
              <div className='hidden md:block'>{tree}</div>
              <p className='mt-2 hidden text-xs leading-snug text-muted-foreground md:block'>
                {t('categoryManagement.dragHint')}
              </p>
              {!rows.length && (
                <p role='status' className='p-4 text-sm text-muted-foreground'>
                  {t('categoryManagement.empty')}
                </p>
              )}
              {rows.length > 0 && !visible.length && (
                <p role='status' className='p-4 text-sm text-muted-foreground'>
                  {t('categoryManagement.noResults')}
                </p>
              )}
            </aside>
            {selected ? (
              <section
                className='@container min-h-0 min-w-0 rounded-lg border border-border bg-card [scrollbar-gutter:stable] md:overflow-y-auto'
                aria-label={selected.name}
              >
                <div className='grid min-w-0 gap-6 p-4 sm:p-5 md:p-5'>
                  <header className='flex min-w-0 flex-wrap items-start justify-between gap-3'>
                    <h2
                      ref={titleRef}
                      tabIndex={-1}
                      className='min-w-0 basis-full font-heading text-2xl font-semibold tracking-tight md:basis-0 md:flex-1'
                    >
                      <InlineCategoryField
                        key={`${id}:name`}
                        category={selected}
                        field='name'
                        editable={canEdit}
                        onSaved={reload}
                        title
                      />
                    </h2>
                    <div className='flex items-center gap-2'>
                      {canCreate && (
                        <Button
                          nativeButton={false}
                          variant='outline'
                          render={
                            <Link to={modalLink('create', { parentId: id })} />
                          }
                        >
                          <Plus />
                          {t('categoryManagement.createChild')}
                        </Button>
                      )}
                      {detailsMenu}
                    </div>
                  </header>
                  <div className='grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-5 @4xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'>
                    <div className='grid min-w-0 gap-5 rounded-xl border p-4'>
                      <div className='grid gap-3'>
                        <h3 className='flex items-center gap-2 border-b pb-2 text-sm font-semibold'>
                          <span className='h-3 w-1 rounded bg-primary' />
                          {t('categoryManagement.basics')}
                        </h3>
                        <dl className='grid gap-2 text-sm'>
                          <div className='grid gap-1 sm:grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)] sm:gap-3'>
                            <dt className='text-muted-foreground'>
                              {t('categoryManagement.parent')}
                            </dt>
                            <dd className='min-w-0'>
                              {selected.parentId &&
                              rows.some(
                                (row) => row.id === selected.parentId,
                              ) ? (
                                <Button
                                  variant='link'
                                  className='h-auto p-0 text-foreground'
                                  onClick={() => select(selected.parentId!)}
                                >
                                  {
                                    rows.find(
                                      (row) => row.id === selected.parentId,
                                    )?.name
                                  }
                                </Button>
                              ) : (
                                '—'
                              )}
                            </dd>
                          </div>
                          <div className='grid items-start gap-1 sm:grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)] sm:gap-3'>
                            <dt className='text-muted-foreground'>
                              {t('categoryManagement.code')}
                            </dt>
                            <dd className='min-w-0'>
                              <InlineCategoryField
                                key={`${id}:code`}
                                category={selected}
                                field='code'
                                editable={canEdit}
                                onSaved={reload}
                              />
                            </dd>
                          </div>
                          <div className='grid items-start gap-1 sm:grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)] sm:gap-3'>
                            <dt className='text-muted-foreground'>
                              {t('categoryManagement.description')}
                            </dt>
                            <dd className='min-w-0'>
                              <InlineCategoryField
                                key={`${id}:description`}
                                category={selected}
                                field='description'
                                editable={canEdit}
                                onSaved={reload}
                              />
                            </dd>
                          </div>
                        </dl>
                      </div>
                      <div className='grid gap-3'>
                        <h3 className='flex items-center gap-2 border-b pb-2 text-sm font-semibold'>
                          <span className='h-3 w-1 rounded bg-primary' />
                          {t('categoryManagement.system')}
                        </h3>
                        <dl className='grid gap-2 text-sm'>
                          {[
                            [
                              t('categoryManagement.creator'),
                              selected.createdById === session?.user.id
                                ? session.user.name
                                : '—',
                            ],
                            [
                              t('categoryManagement.createdAt'),
                              date(selected.createdAt),
                            ],
                            [
                              t('categoryManagement.updatedAt'),
                              date(selected.updatedAt),
                            ],
                          ].map(([label, value]) => (
                            <div
                              key={label}
                              className='grid gap-1 sm:grid-cols-[minmax(6rem,1fr)_minmax(0,1fr)] sm:gap-3'
                            >
                              <dt className='text-muted-foreground'>{label}</dt>
                              <dd className='min-w-0 break-words'>{value}</dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    </div>
                    <div className='min-w-0 rounded-xl border p-3 sm:p-4'>
                      <Tabs
                        value={tab}
                        onValueChange={(value) =>
                          set({
                            tab:
                              value === 'history' ? undefined : String(value),
                            page: undefined,
                            historyPage: undefined,
                          })
                        }
                        className='min-w-0 gap-4'
                      >
                        <TabsList
                          variant='line'
                          className='w-full justify-start overflow-x-auto border-b'
                        >
                          <TabsTrigger value='history'>
                            <History />
                            {t('categoryManagement.history')}
                          </TabsTrigger>
                          <TabsTrigger value='materials'>
                            <Boxes />
                            {t('categoryManagement.materials')}
                            {canViewMaterials && materialCount.data && (
                              <span>{materialCount.data.meta.total}</span>
                            )}
                          </TabsTrigger>
                          <TabsTrigger value='children'>
                            <ListTree />
                            {t('categoryManagement.children')}{' '}
                            <span>{childRows.length}</span>
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value='history'>
                          <CategoryHistory
                            key={id}
                            id={id}
                            categories={rows}
                            params={params}
                            active={active && tab === 'history'}
                            revision={revision}
                            canComment={canComment}
                            onQuery={(values) => set(values)}
                          />
                        </TabsContent>
                        <TabsContent value='materials'>
                          {canViewMaterials ? (
                            <CategoryMaterials
                              key={id}
                              id={id}
                              params={params}
                              active={active && tab === 'materials'}
                            />
                          ) : (
                            <p className='text-sm text-muted-foreground'>
                              {t('categoryManagement.noMaterialAccess')}
                            </p>
                          )}
                        </TabsContent>
                        <TabsContent value='children'>
                          <CategoryChildren rows={childRows} select={select} />
                        </TabsContent>
                      </Tabs>
                    </div>
                  </div>
                </div>
              </section>
            ) : (
              <section className='grid min-h-80 place-content-center rounded-lg border p-6 text-sm text-muted-foreground'>
                <p role='status'>
                  {t(
                    rows.length
                      ? 'categoryManagement.unavailable'
                      : 'categoryManagement.empty',
                  )}
                </p>
                {first && (
                  <Button variant='ghost' onClick={() => select(first.id)}>
                    {t('categoryManagement.selectFirst')}
                  </Button>
                )}
              </section>
            )}
          </div>
        </ListFeedback>
        <ConfirmAction
          open={Boolean(removing)}
          title={t('categoryManagement.deleteTitle', {
            name: removing?.name ?? '',
          })}
          description={t('categoryManagement.deleteHint')}
          confirmLabel={t('categoryManagement.remove')}
          busy={deleteSubmission.submitting}
          error={<CategoryError error={error} />}
          onCancel={() => {
            setRemoving(undefined);
            setError(undefined);
          }}
          onConfirm={() => {
            void remove();
          }}
        />
      </PageContainer>
      <Outlet context={context} />
    </>
  );
}
