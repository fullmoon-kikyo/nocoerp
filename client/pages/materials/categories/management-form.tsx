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
  useParams,
  useResolvedPath,
  useOutletContext,
} from 'react-router';
import { useApiClient, useSubmission, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { FeedbackForm } from '#components/feedback-form';
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { PendingButton } from '#components/pending-button';
import { Loading } from '#components/loading';
import { useListData } from '#hooks/use-list-data';
import { useSettingsLeave } from '../../settings/hooks.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';
import { CategoryError, type CategoryPageContext } from './shared.js';

import { categoryPath, useCategoryPermission } from './model.js';

const formId = 'category-management-form';
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
        {t('categoryManagement.save')}
      </PendingButton>
    </>
  );
}

function Body({
  mode,
  onBusy,
  onReady,
}: {
  mode: 'edit' | 'move';
  onBusy: (value: boolean) => void;
  onReady: (value: boolean) => void;
}): ReactElement {
  const { id } = useParams();
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const location = useLocation();
  const navigate = useNavigate();
  const listPath = useResolvedPath('..').pathname;
  const parent = useOutletContext<CategoryPageContext>();
  const { session } = useAuthentication();
  const rows = useListData<{ data: MaterialCategory[] }>(
    'materialMaster/categories',
  );
  const record = rows.data?.data.find((row) => row.id === id);
  const allowed = useCategoryPermission(mode);
  const [draft, setDraft] = useState<{
    code: string;
    name: string;
    description: string;
    parentId: string | null;
    index: number;
    version: number;
  }>();
  const initial = {
    code: record?.code ?? '',
    name: record?.name ?? '',
    description: record?.description ?? '',
    parentId: record?.parentId ?? null,
    index: (rows.data?.data ?? [])
      .filter((row) => row.parentId === record?.parentId)
      .findIndex((row) => row.id === id),
    version: record?.version ?? 1,
  };
  const value = draft ?? initial;
  const [error, setError] = useState<unknown>();
  const [invalid, setInvalid] = useState(false);
  const codeInvalid =
    invalid && (!value.code.trim() || /\s/.test(value.code.trim()));
  const nameInvalid = invalid && !value.name.trim();
  const codeRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const submission = useSubmission({
    scope: `${session?.user.id}:category:${id}:${mode}`,
  });
  const leave = useSettingsLeave(
    Boolean(draft && JSON.stringify(draft) !== JSON.stringify(initial)),
    submission.submitting,
  );
  useEffect(() => {
    onBusy(submission.submitting);
    return () => onBusy(false);
  }, [onBusy, submission.submitting]);
  useEffect(() => {
    onReady(Boolean(record && allowed && !rows.error));
    return () => onReady(false);
  }, [record, allowed, rows.error, onReady]);
  const descendants = new Set<string>(id ? [id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows.data?.data ?? [])
      if (
        row.parentId &&
        descendants.has(row.parentId) &&
        !descendants.has(row.id)
      ) {
        descendants.add(row.id);
        changed = true;
      }
  }
  const parentChoices = (rows.data?.data ?? []).filter(
    (row) => !descendants.has(row.id),
  );
  const siblings = (rows.data?.data ?? []).filter(
    (row) => row.id !== id && row.parentId === value.parentId,
  );
  const save = async () => {
    if (!allowed || !record) return;
    setError(undefined);
    setInvalid(false);
    try {
      const result = await submission.run(value, (key, signal, snapshot) => {
        if (
          mode === 'edit' &&
          (!snapshot.code.trim() ||
            !snapshot.name.trim() ||
            /\s/.test(snapshot.code.trim()))
        ) {
          setInvalid(true);
          requestAnimationFrame(() =>
            (!snapshot.code.trim() || /\s/.test(snapshot.code.trim())
              ? codeRef
              : nameRef
            ).current?.focus(),
          );
          return Promise.resolve(undefined);
        }
        return api.request<{ data: MaterialCategory }>({
          path: `materialMaster/categories/${id}${mode === 'move' ? '/move' : ''}`,
          method: mode === 'move' ? 'POST' : 'PATCH',
          headers: { 'Idempotency-Key': key },
          signal,
          json:
            mode === 'move'
              ? {
                  parentId: snapshot.parentId,
                  index: snapshot.index,
                  expectedVersion: snapshot.version,
                }
              : {
                  code: snapshot.code,
                  name: snapshot.name,
                  description: snapshot.description,
                  expectedVersion: snapshot.version,
                },
        });
      });
      if (!result) return;
      toaster.show({
        type: 'success',
        title: t(
          mode === 'move'
            ? 'categoryManagement.movedToast'
            : 'categoryManagement.saved',
          { name: result.data.name },
        ),
      });
      leave.allow();
      onBusy(false);
      await navigate(
        { pathname: listPath, search: location.search },
        { replace: true },
      );
      parent.reload();
    } catch (next) {
      setError(next);
    }
  };
  return (
    <>
      <CategoryError error={rows.error} retry={rows.reload} />
      {!rows.data && rows.loading ? (
        <Loading identity={id} />
      ) : !record ? (
        <p role='status'>{t('categoryManagement.unavailable')}</p>
      ) : (
        <FeedbackForm
          id={formId}
          noValidate
          values={() => value}
          savedValues={initial}
          error={error}
          errorContent={
            <CategoryError
              error={error}
              retry={() => {
                setDraft(undefined);
                setError(undefined);
                rows.reload();
              }}
            />
          }
          submitting={submission.submitting}
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {mode === 'edit' ? (
            <>
              <div className='grid gap-2'>
                <Label htmlFor='category-edit-code'>
                  {t('categoryManagement.code')} *
                </Label>
                <Input
                  ref={codeRef}
                  id='category-edit-code'
                  value={value.code}
                  required
                  maxLength={64}
                  disabled={!allowed || submission.submitting}
                  aria-invalid={codeInvalid}
                  aria-describedby={
                    codeInvalid ? 'category-edit-code-error' : undefined
                  }
                  onChange={(event) =>
                    setDraft({ ...value, code: event.target.value })
                  }
                />
                {codeInvalid && (
                  <p
                    id='category-edit-code-error'
                    role='alert'
                    className='text-sm text-destructive'
                  >
                    {t('categoryManagement.codeFormat')}
                  </p>
                )}
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='category-edit-name'>
                  {t('categoryManagement.name')} *
                </Label>
                <Input
                  ref={nameRef}
                  id='category-edit-name'
                  value={value.name}
                  required
                  maxLength={100}
                  disabled={!allowed || submission.submitting}
                  aria-invalid={nameInvalid}
                  aria-describedby={
                    nameInvalid ? 'category-edit-name-error' : undefined
                  }
                  onChange={(event) =>
                    setDraft({ ...value, name: event.target.value })
                  }
                />
                {nameInvalid && (
                  <p
                    id='category-edit-name-error'
                    role='alert'
                    className='text-sm text-destructive'
                  >
                    {t('categoryManagement.nameRequired')}
                  </p>
                )}
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='category-edit-description'>
                  {t('categoryManagement.description')}
                </Label>
                <Textarea
                  id='category-edit-description'
                  value={value.description}
                  maxLength={2000}
                  disabled={!allowed || submission.submitting}
                  onChange={(event) =>
                    setDraft({ ...value, description: event.target.value })
                  }
                />
              </div>
            </>
          ) : (
            <>
              <p className='text-sm text-muted-foreground'>
                {t('categoryManagement.moveHint')}
              </p>
              <div className='grid gap-2'>
                <Label htmlFor='category-move-parent'>
                  {t('categoryManagement.parent')}
                </Label>
                <Select
                  value={value.parentId ?? ''}
                  items={[
                    { value: '', label: t('categoryManagement.root') },
                    ...parentChoices.map((row) => ({
                      value: row.id,
                      label: categoryPath(row, rows.data?.data ?? []),
                    })),
                  ]}
                  disabled={!allowed || submission.submitting}
                  onValueChange={(next) => {
                    if (next !== null)
                      setDraft({
                        ...value,
                        parentId: next || null,
                        index: (rows.data?.data ?? []).filter(
                          (row) =>
                            row.id !== id && row.parentId === (next || null),
                        ).length,
                      });
                  }}
                >
                  <SelectTrigger id='category-move-parent' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                    <SelectItem value=''>
                      {t('categoryManagement.root')}
                    </SelectItem>
                    {parentChoices.map((row) => (
                      <SelectItem key={row.id} value={row.id}>
                        {categoryPath(row, rows.data?.data ?? [])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className='grid gap-2'>
                <Label htmlFor='category-move-index'>
                  {t('categoryManagement.position')}
                </Label>
                <Select
                  value={String(value.index)}
                  items={[
                    ...siblings.map((row, index) => ({
                      value: String(index),
                      label: t('categoryManagement.before', { name: row.name }),
                    })),
                    {
                      value: String(siblings.length),
                      label: t('categoryManagement.last'),
                    },
                  ]}
                  disabled={!allowed || submission.submitting}
                  onValueChange={(next) => {
                    if (next !== null)
                      setDraft({ ...value, index: Number(next) });
                  }}
                >
                  <SelectTrigger id='category-move-index' className='w-full'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                    {siblings.map((row, index) => (
                      <SelectItem key={row.id} value={String(index)}>
                        {t('categoryManagement.before', { name: row.name })}
                      </SelectItem>
                    ))}
                    <SelectItem value={String(siblings.length)}>
                      {t('categoryManagement.last')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </FeedbackForm>
      )}
      {leave.dialog}
    </>
  );
}

export function CategoryManagementForm({
  mode,
}: {
  mode: 'edit' | 'move';
}): ReactElement {
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
      title={t(
        mode === 'move' ? 'categoryManagement.move' : 'categoryManagement.edit',
      )}
      beforeClose={() => !busyRef.current}
      footer={<Footer busy={busy} ready={ready} />}
    >
      <Body mode={mode} onBusy={onBusy} onReady={setReady} />
    </RouteDialog>
  );
}
