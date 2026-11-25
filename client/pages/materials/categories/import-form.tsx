import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  useLocation,
  useNavigate,
  useResolvedPath,
  useOutletContext,
} from 'react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { useApiClient, useSubmission, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { FeedbackForm } from '#components/feedback-form';
import { DataTable } from '#components/data-table';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { PendingButton } from '#components/pending-button';
import { useSettingsLeave } from '../../settings/hooks.js';
import type {
  CategoryImportPreview,
  CategoryImportIssue,
  CategoryImportRow,
} from '../../../../shared/material-categories.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';
import { CategoryError, type CategoryPageContext } from './shared.js';

import { downloadCategoryCsv, useCategoryPermission } from './model.js';

const formId = 'category-import-form';
function Footer({
  busy,
  ready,
}: {
  busy: boolean;
  ready: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={busy}
        onClick={() => {
          void close();
        }}
      >
        {t('categoryManagement.cancel')}
      </Button>
      <PendingButton type='submit' form={formId} busy={busy} disabled={!ready}>
        {t('categoryManagement.commit')}
      </PendingButton>
    </>
  );
}

function Body({
  onBusy,
  onReady,
}: {
  onBusy: (value: boolean) => void;
  onReady: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { session } = useAuthentication();
  const navigate = useNavigate();
  const listPath = useResolvedPath('..').pathname;
  const location = useLocation();
  const parent = useOutletContext<CategoryPageContext>();
  const canImport = useCategoryPermission('import');
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{
    csv: string;
    report: CategoryImportPreview;
  }>();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<unknown>();
  const [fileError, setFileError] = useState<string>();
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controllerRef.current?.abort(), []);
  const submission = useSubmission({
    scope: `${session?.user.id}:categories:import`,
  });
  const leave = useSettingsLeave(Boolean(csv), submission.submitting);
  const report = preview?.csv === csv ? preview.report : undefined;
  const ready = Boolean(
    canImport && report?.total && !report.errors.length && !reading,
  );
  useEffect(() => {
    onBusy(submission.submitting);
    return () => onBusy(false);
  }, [onBusy, submission.submitting]);
  useEffect(() => {
    onReady(ready);
    return () => onReady(false);
  }, [onReady, ready]);
  const validate = async () => {
    if (!csv || !canImport) return;
    controllerRef.current?.abort();
    const request = new AbortController();
    controllerRef.current = request;
    setReading(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: CategoryImportPreview }>({
        path: 'materialMaster/categories/import/preview',
        method: 'POST',
        json: { csv },
        signal: request.signal,
      });
      if (!request.signal.aborted) setPreview({ csv, report: response.data });
    } catch (next) {
      if (!request.signal.aborted) setError(next);
    } finally {
      if (controllerRef.current === request) setReading(false);
    }
  };
  const commit = async () => {
    if (!ready) return;
    setError(undefined);
    try {
      const result = await submission.run({ csv }, (key, signal, snapshot) =>
        api.request<{ data: MaterialCategory[] }>({
          path: 'materialMaster/categories/import',
          method: 'POST',
          json: snapshot,
          headers: { 'Idempotency-Key': key },
          signal,
        }),
      );
      if (!result) return;
      toaster.show({
        type: 'success',
        title: t('categoryManagement.importDone', {
          count: result.data.length,
        }),
      });
      leave.allow();
      onBusy(false);
      const params = new URLSearchParams(location.search);
      if (result.data[0]) params.set('selected', result.data[0].id);
      await navigate(
        { pathname: listPath, search: params.toString() },
        { replace: true },
      );
      parent.reload();
    } catch (next) {
      setError(next);
    }
  };
  const issueLabel = (reason: string) =>
    t(
      `categoryManagement.${({ invalid: 'csvInvalid', duplicate: 'csvDuplicate', parent: 'csvParent', cycle: 'csvCycle', headers: 'csvHeaders', limit: 'csvLimit', format: 'csvFormat' } as Record<string, string>)[reason] ?? 'csvInvalid'}`,
    );
  const issueColumns: ColumnDef<CategoryImportIssue>[] = [
    { accessorKey: 'line', header: t('categoryManagement.line') },
    { accessorKey: 'field', header: t('categoryManagement.field') },
    {
      id: 'reason',
      header: t('categoryManagement.issue'),
      accessorFn: (row) => issueLabel(row.reason),
    },
  ];
  const rowColumns: ColumnDef<CategoryImportRow>[] = [
    { accessorKey: 'line', header: t('categoryManagement.line') },
    { accessorKey: 'code', header: t('categoryManagement.code') },
    { accessorKey: 'name', header: t('categoryManagement.name') },
    { accessorKey: 'parentCode', header: t('categoryManagement.parentCode') },
  ];
  return (
    <>
      <FeedbackForm
        id={formId}
        noValidate
        values={() => ({ csv })}
        savedValues={{ csv: '' }}
        error={error}
        errorContent={<CategoryError error={error} />}
        submitting={submission.submitting}
        className='grid min-w-0 gap-4'
        onSubmit={(event) => {
          event.preventDefault();
          void commit();
        }}
      >
        <p className='text-sm text-muted-foreground'>
          {t('categoryManagement.csvHelp')}
        </p>
        <Button
          type='button'
          variant='outline'
          className='justify-self-start'
          onClick={() =>
            downloadCategoryCsv(
              '\uFEFFcode,name,parentCode,description\n',
              'material-categories-template.csv',
            )
          }
        >
          {t('categoryManagement.template')}
        </Button>
        <div className='grid gap-2'>
          <Label htmlFor='category-import-file'>
            {t('categoryManagement.file')}
          </Label>
          <Input
            id='category-import-file'
            type='file'
            accept='.csv,text/csv'
            disabled={!canImport || submission.submitting}
            onChange={(event) => {
              const file = event.target.files?.[0];
              const ticket = ++generationRef.current;
              controllerRef.current?.abort();
              setReading(false);
              setCsv('');
              setPreview(undefined);
              setError(undefined);
              setFileError(undefined);
              if (!file) return;
              if (file.size > 512 * 1024) {
                setFileError(t('categoryManagement.csvLimit'));
                return;
              }
              void file.text().then(
                (content) => {
                  if (generationRef.current === ticket) setCsv(content);
                },
                (next: unknown) => {
                  if (generationRef.current === ticket) setError(next);
                },
              );
            }}
          />
        </div>
        {fileError && (
          <p role='alert' className='text-sm text-destructive'>
            {fileError}
          </p>
        )}
        <p className='text-xs text-muted-foreground'>
          {t('categoryManagement.csvEscape')}
        </p>
        <PendingButton
          type='button'
          variant='outline'
          busy={reading}
          disabled={!csv || !canImport || submission.submitting}
          onClick={() => {
            void validate();
          }}
        >
          {t('categoryManagement.preview')}
        </PendingButton>
        {report && (
          <>
            <p
              role={report.errors.length ? 'alert' : 'status'}
              className={
                report.errors.length
                  ? 'text-sm text-destructive'
                  : 'text-sm text-muted-foreground'
              }
            >
              {t(
                report.errors.length
                  ? 'categoryManagement.invalidPreview'
                  : 'categoryManagement.validPreview',
              )}{' '}
              · {t('categoryManagement.totalRows', { count: report.total })}
            </p>
            {report.errors.length > 0 && (
              <DataTable
                columns={issueColumns}
                data={report.errors}
                showSelectedCount={false}
                pageSize={5}
                renderCard={(row) => (
                  <article className='grid gap-1 rounded-lg border p-3'>
                    <p className='text-sm'>
                      {t('categoryManagement.line')} {row.original.line} ·{' '}
                      {row.original.field}
                    </p>
                    <p className='text-sm text-destructive'>
                      {issueLabel(row.original.reason)}
                    </p>
                  </article>
                )}
              />
            )}
            {report.rows.length > 0 && (
              <DataTable
                columns={rowColumns}
                data={report.rows}
                showSelectedCount={false}
                pageSize={5}
                getRowId={(row) => String(row.line)}
                renderCard={(row) => (
                  <article className='grid gap-1 rounded-lg border p-3'>
                    <p className='text-sm font-medium break-words'>
                      {row.original.code} · {row.original.name}
                    </p>
                    <p className='text-xs text-muted-foreground'>
                      {t('categoryManagement.parentCode')}:{' '}
                      {row.original.parentCode || '—'}
                    </p>
                  </article>
                )}
              />
            )}
          </>
        )}
      </FeedbackForm>
      {leave.dialog}
    </>
  );
}

export default function CategoryImportForm(): ReactElement {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const busyRef = useRef(false);
  const onBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);
  return (
    <RouteDialog
      title={t('categoryManagement.import')}
      beforeClose={() => !busyRef.current}
      footer={<Footer busy={busy} ready={ready} />}
    >
      <Body onBusy={onBusy} onReady={setReady} />
    </RouteDialog>
  );
}
