import { useRef, useState, type ReactElement } from 'react';
import {
  useNavigate,
  useLocation,
  useOutletContext,
  useParams,
  useResolvedPath,
} from 'react-router';
import {
  useApiClient,
  useSubmission,
  useToaster,
  ApiClientError,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { FeedbackForm } from '#components/feedback-form';
import { RouteChildPage } from '#components/route-child-page';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { PendingButton } from '#components/pending-button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';
import { Checkbox } from '#components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { useListData } from '#hooks/use-list-data';
import { useSettingsLeave } from '../settings/hooks.js';
import { SettingsLoading } from '../settings/shared.js';
import {
  blankMaterial,
  materialInputSchema,
  type Material,
  type MaterialCategory,
  type MaterialInput,
} from '../../../shared/material-master-data.js';
import { MaterialError } from './shared.js';
import type { MaterialPageContext } from './model.js';

function MaterialFormBody(): ReactElement {
  const { id } = useParams();
  const creating = !id;
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const listPath = useResolvedPath('..').pathname;
  const parent = useOutletContext<MaterialPageContext>();
  const { session } = useAuthentication();
  const categories = useListData<{ data: MaterialCategory[] }>(
    'materialMaster/categories',
  );
  const record = useListData<{ data: Material }>(
    `materialMaster/materials/${id ?? ''}`,
    { active: !creating },
  );
  const selected = new URLSearchParams(location.search).get('categoryId') ?? '';
  const initial: MaterialInput = record.data
    ? materialInputSchema.strip().parse(record.data.data)
    : { ...blankMaterial, categoryId: selected };
  const [draft, setDraft] = useState<MaterialInput>();
  const value = draft ?? initial;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const formRef = useRef<HTMLFormElement>(null);
  const canWrite = useCan({
    resource: { type: 'composite', id: 'masterData.materials' },
    action: creating ? 'create' : 'edit',
  }).can;
  const submission = useSubmission({
    scope: `${session?.user.id}:materials:${id ?? `create:${selected}`}`,
  });
  const dirty =
    draft !== undefined && JSON.stringify(draft) !== JSON.stringify(initial);
  const leave = useSettingsLeave(dirty, submission.submitting);
  const readonly = !canWrite || submission.submitting;
  const close = () => {
    void navigate({ pathname: listPath, search: location.search });
  };
  const update = <K extends keyof MaterialInput>(
    key: K,
    next: MaterialInput[K],
  ) => {
    setDraft({ ...value, [key]: next });
    setErrors((old) => ({ ...old, [key]: '' }));
  };
  const save = async () => {
    if (!canWrite) return;
    setError(undefined);
    try {
      const saved = await submission.run(
        { values: value, expectedVersion: record.data?.data.version },
        async (key, signal, snapshot) => {
          const validated = materialInputSchema.safeParse(snapshot.values);
          if (!validated.success) {
            setErrors(
              Object.fromEntries(
                validated.error.issues.map((issue) => [
                  String(issue.path[0]),
                  t(
                    issue.code === 'too_small'
                      ? 'materials.required'
                      : 'materials.invalid',
                  ),
                ]),
              ),
            );
            requestAnimationFrame(() =>
              formRef.current
                ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus(),
            );
            return undefined;
          }
          return api.request<{ data: Material }>({
            path: creating
              ? 'materialMaster/materials'
              : `materialMaster/materials/${id}`,
            method: creating ? 'POST' : 'PATCH',
            headers: { 'Idempotency-Key': key },
            signal,
            json: creating
              ? validated.data
              : {
                  ...validated.data,
                  expectedVersion: snapshot.expectedVersion,
                },
          });
        },
      );
      if (!saved) return;
      leave.allow();
      parent.reload();
      toaster.show({ type: 'success', title: t('materials.saved') });
      close();
    } catch (next) {
      setError(next);
      if (
        next instanceof ApiClientError &&
        next.reason === 'MATERIAL_CODE_EXISTS'
      )
        setErrors((old) => ({ ...old, code: t('materials.duplicate') }));
    }
  };
  const field = (
    key: Exclude<keyof MaterialInput, 'enabled' | 'categoryId' | 'remarks'>,
    required = false,
  ) => (
    <div className='grid min-w-0 gap-2' key={key}>
      <Label htmlFor={`material-${key}`}>
        {t(`materials.${key}`)}
        {required ? ' *' : ''}
      </Label>
      <Input
        id={`material-${key}`}
        name={key}
        value={value[key]}
        required={required}
        disabled={readonly}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `material-${key}-error` : undefined}
        onChange={(event) => update(key, event.target.value)}
      />
      {errors[key] && (
        <p id={`material-${key}-error`} className='text-sm text-destructive'>
          {errors[key]}
        </p>
      )}
    </div>
  );
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t(creating ? 'materials.newMaterial' : 'materials.details')}
        description={t('materials.description')}
      />
      <MaterialError
        error={record.error ?? categories.error}
        retry={() => {
          record.reload();
          categories.reload();
        }}
      />
      {(!creating && !record.data && record.loading) ||
      (!categories.data && categories.loading) ? (
        <SettingsLoading />
      ) : (
        !record.error &&
        !categories.error &&
        (creating || record.data) && (
          <FeedbackForm
            ref={formRef}
            noValidate
            values={() => value}
            savedValues={initial}
            submitting={submission.submitting}
            error={error}
            errorContent={
              <MaterialError
                error={error}
                retry={
                  error instanceof ApiClientError &&
                  error.reason === 'VERSION_CONFLICT'
                    ? () => {
                        setDraft(undefined);
                        setError(undefined);
                        record.reload();
                      }
                    : undefined
                }
              />
            }
            className='grid min-w-0 gap-6'
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            {!canWrite && (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('materials.readonly')}
              </p>
            )}
            {!categories.data?.data.length && (
              <p role='status' className='text-sm text-muted-foreground'>
                {t('materials.categoryRequired')}
              </p>
            )}
            <div className='grid min-w-0 gap-4 sm:grid-cols-2'>
              {field('code', true)}
              {field('name', true)}
              <div className='grid min-w-0 gap-2'>
                <Label htmlFor='material-categoryId'>
                  {t('materials.categoryId')} *
                </Label>
                <Select
                  value={value.categoryId}
                  items={(categories.data?.data ?? []).map((category) => ({
                    value: category.id,
                    label: `${category.code} · ${category.name}`,
                  }))}
                  disabled={readonly}
                  onValueChange={(next) => {
                    if (next !== null) update('categoryId', next);
                  }}
                >
                  <SelectTrigger
                    id='material-categoryId'
                    className='w-full'
                    aria-invalid={Boolean(errors.categoryId)}
                  >
                    <SelectValue placeholder={t('materials.chooseCategory')} />
                  </SelectTrigger>
                  <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                    {(categories.data?.data ?? []).map((category) => (
                      <SelectItem value={category.id} key={category.id}>
                        {category.code} · {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.categoryId && (
                  <p className='text-sm text-destructive'>
                    {errors.categoryId}
                  </p>
                )}
              </div>
              {field('unit', true)}
              {field('specification')}
              {field('drawingNumber')}
              {field('materialGrade')}
              <div className='flex items-center gap-3 self-end py-2'>
                <Checkbox
                  id='material-enabled'
                  checked={value.enabled}
                  disabled={readonly}
                  onCheckedChange={(checked) =>
                    update('enabled', Boolean(checked))
                  }
                />
                <Label htmlFor='material-enabled'>
                  {t('materials.enabled')}
                </Label>
              </div>
            </div>
            <p className='text-xs text-muted-foreground'>
              {t('materials.manualCode')} {t('materials.unitHint')}
            </p>
            <div className='grid gap-2'>
              <Label htmlFor='material-remarks'>{t('materials.remarks')}</Label>
              <Textarea
                id='material-remarks'
                disabled={readonly}
                value={value.remarks}
                onChange={(event) => update('remarks', event.target.value)}
              />
            </div>
            <div className='flex justify-end gap-2 border-t pt-4'>
              <Button
                type='button'
                variant='outline'
                disabled={submission.submitting}
                onClick={() => {
                  void Promise.resolve(leave.guard()).then((allowed) => {
                    if (allowed) close();
                  });
                }}
              >
                {t('materials.cancel')}
              </Button>
              {canWrite && (
                <PendingButton
                  type='submit'
                  busy={submission.submitting}
                  disabled={
                    submission.submitting ||
                    !categories.data?.data.length ||
                    (!creating && !dirty)
                  }
                >
                  {t('materials.save')}
                </PendingButton>
              )}
            </div>
          </FeedbackForm>
        )
      )}
      {leave.dialog}
    </PageContainer>
  );
}

export default function MaterialForm(): ReactElement {
  const { id } = useParams();
  return (
    <RouteChildPage>
      <MaterialFormBody key={id ?? 'create'} />
    </RouteChildPage>
  );
}
