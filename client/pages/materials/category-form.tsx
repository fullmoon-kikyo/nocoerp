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
  useOutletContext,
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
import { RouteDialog } from '#components/route-dialog';
import { useRouteOverlay } from '#components/use-route-overlay';
import { Button } from '#components/ui/button';
import { PendingButton } from '#components/pending-button';
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
import { useListData } from '#hooks/use-list-data';
import { useSettingsLeave } from '../settings/hooks.js';
import {
  categoryInputSchema,
  type CategoryInput,
  type MaterialCategory,
} from '../../../shared/material-master-data.js';
import { MaterialError } from './shared.js';
import type { MaterialPageContext } from './model.js';

const formId = 'material-category-form';
function CategoryBody({
  onBusy,
}: {
  onBusy: (busy: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const listPath = useResolvedPath('..').pathname;
  const parent = useOutletContext<MaterialPageContext>();
  const location = useLocation();
  const initial: CategoryInput = {
    code: '',
    name: '',
    parentId: new URLSearchParams(location.search).get(
      parent.categorySelectionParam === 'selected' ? 'parentId' : 'categoryId',
    ),
    description: '',
  };
  const [draft, setDraft] = useState<CategoryInput>();
  const value = draft ?? initial;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>();
  const formRef = useRef<HTMLFormElement>(null);
  const { session } = useAuthentication();
  const submission = useSubmission({
    scope: `${session?.user.id}:material-category:create:${initial.parentId ?? 'root'}`,
  });
  const canCreate = useCan({
    resource: { type: 'composite', id: 'masterData.categories' },
    action: 'create',
  }).can;
  const categories = useListData<{ data: MaterialCategory[] }>(
    'materialMaster/categories',
  );
  const leave = useSettingsLeave(
    draft !== undefined && JSON.stringify(draft) !== JSON.stringify(initial),
    submission.submitting,
  );
  useEffect(() => {
    onBusy(submission.submitting);
    return () => onBusy(false);
  }, [onBusy, submission.submitting]);
  const save = async () => {
    if (!canCreate) return;
    setError(undefined);
    try {
      const saved = await submission.run(
        value,
        async (key, signal, snapshot) => {
          const result = categoryInputSchema.safeParse(snapshot);
          if (!result.success) {
            setErrors(
              Object.fromEntries(
                result.error.issues.map((issue) => [
                  String(issue.path[0]),
                  t('materials.invalid'),
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
          return api.request<{ data: MaterialCategory }>({
            path: 'materialMaster/categories',
            method: 'POST',
            json: result.data,
            headers: { 'Idempotency-Key': key },
            signal,
          });
        },
      );
      if (!saved) return;
      leave.allow();
      onBusy(false);
      const search = new URLSearchParams(location.search);
      search.set(parent.categorySelectionParam ?? 'categoryId', saved.data.id);
      search.delete('parentId');
      search.delete('page');
      await navigate(
        { pathname: listPath, search: search.toString() },
        { replace: true },
      );
      parent.reload();
      toaster.show({
        type: 'success',
        title: t('categoryManagement.createdToast', { name: saved.data.name }),
      });
    } catch (next) {
      setError(next);
      if (
        next instanceof ApiClientError &&
        next.reason === 'MATERIAL_CODE_EXISTS'
      )
        setErrors((old) => ({ ...old, code: t('materials.duplicate') }));
    }
  };
  return (
    <>
      <MaterialError error={categories.error} retry={categories.reload} />
      <FeedbackForm
        id={formId}
        ref={formRef}
        noValidate
        values={() => value}
        savedValues={initial}
        submitting={submission.submitting}
        error={error}
        errorContent={<MaterialError error={error} />}
        className='grid gap-4'
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {(['code', 'name'] as const).map((field) => (
          <div className='grid gap-2' key={field}>
            <Label htmlFor={`category-${field}`}>
              {t(
                field === 'code'
                  ? 'materials.categoryCode'
                  : 'materials.categoryName',
              )}{' '}
              *
            </Label>
            <Input
              id={`category-${field}`}
              name={field}
              value={value[field]}
              required
              disabled={!canCreate || submission.submitting}
              aria-invalid={Boolean(errors[field])}
              onChange={(event) => {
                setDraft({ ...value, [field]: event.target.value });
                setErrors((old) => ({ ...old, [field]: '' }));
              }}
            />
            {errors[field] && (
              <p className='text-sm text-destructive'>{errors[field]}</p>
            )}
          </div>
        ))}
        <div className='grid gap-2'>
          <Label htmlFor='category-parent'>
            {t('materials.parentCategory')}
          </Label>
          <Select
            value={value.parentId ?? ''}
            items={[
              { value: '', label: t('materials.rootCategory') },
              ...(categories.data?.data ?? []).map((category) => ({
                value: category.id,
                label: `${category.code} · ${category.name}`,
              })),
            ]}
            disabled={
              !canCreate || submission.submitting || Boolean(categories.error)
            }
            onValueChange={(id) => {
              if (id !== null) setDraft({ ...value, parentId: id || null });
            }}
          >
            <SelectTrigger id='category-parent' className='w-full'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
              <SelectItem value=''>{t('materials.rootCategory')}</SelectItem>
              {(categories.data?.data ?? []).map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.code} · {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-2'>
          <Label htmlFor='category-description'>
            {t('categoryManagement.description')}
          </Label>
          <Textarea
            id='category-description'
            value={value.description}
            disabled={!canCreate || submission.submitting}
            maxLength={2000}
            onChange={(event) =>
              setDraft({ ...value, description: event.target.value })
            }
          />
        </div>
      </FeedbackForm>
      {leave.dialog}
    </>
  );
}

function CategoryFooter({ busy }: { busy: boolean }): ReactElement {
  const { close } = useRouteOverlay();
  const { t } = useTranslation();
  const canCreate = useCan({
    resource: { type: 'composite', id: 'masterData.categories' },
    action: 'create',
  }).can;
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={busy}
        onClick={() => {
          void close();
        }}
      >
        {t('materials.cancel')}
      </Button>
      <PendingButton
        form={formId}
        type='submit'
        busy={busy}
        disabled={!canCreate}
      >
        {t('materials.save')}
      </PendingButton>
    </>
  );
}

export default function CategoryForm(): ReactElement {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const updateBusy = useCallback((value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  }, []);
  return (
    <RouteDialog
      title={t('materials.newCategory')}
      beforeClose={() => !busyRef.current}
      footer={<CategoryFooter busy={busy} />}
    >
      <CategoryBody onBusy={updateBusy} />
    </RouteDialog>
  );
}
