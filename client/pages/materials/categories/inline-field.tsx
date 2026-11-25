import { useRef, useState, type ReactElement } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { useApiClient, useSubmission, useToaster } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Textarea } from '#components/ui/textarea';
import { PendingButton } from '#components/pending-button';
import { FeedbackForm } from '#components/feedback-form';
import { LongTextPreview } from '#components/long-text';
import { useSettingsLeave } from '../../settings/hooks.js';
import { ConfirmAction } from '../../settings/shared.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';
import { CategoryError } from './shared.js';

export function InlineCategoryField({
  category,
  field,
  editable,
  onSaved,
  title = false,
}: {
  category: MaterialCategory;
  field: 'name' | 'code' | 'description';
  editable: boolean;
  onSaved: () => void;
  title?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const { session } = useAuthentication();
  const [edit, setEdit] = useState<{
    original: MaterialCategory;
    value: string;
  }>();
  const [error, setError] = useState<unknown>();
  const [discarding, setDiscarding] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement>(null);
  const ref = useRef<HTMLInputElement>(null);
  const submission = useSubmission({
    scope: `${session?.user.id}:categories:inline:${category.id}:${field}`,
  });
  const leave = useSettingsLeave(
    Boolean(edit && edit.value !== edit.original[field]),
    submission.submitting,
  );
  const save = async () => {
    if (!edit || !editable) return;
    setError(undefined);
    try {
      const result = await submission.run(
        { category: edit.original, value: edit.value },
        (key, signal, snapshot) =>
          api.request({
            path: `materialMaster/categories/${category.id}`,
            method: 'PATCH',
            headers: { 'Idempotency-Key': key },
            signal,
            json: {
              code: snapshot.category.code,
              name: snapshot.category.name,
              description: snapshot.category.description,
              [field]: snapshot.value,
              expectedVersion: snapshot.category.version,
            },
          }),
      );
      if (!result) return;
      toaster.show({
        type: 'success',
        title: t('categoryManagement.saved', {
          name: field === 'name' ? edit.value.trim() : category.name,
        }),
      });
      setEdit(undefined);
      onSaved();
    } catch (next) {
      setError(next);
    }
  };
  const label = t(`categoryManagement.${field}`);
  const value = category[field] || '—';
  const beginEdit = () => {
    setError(undefined);
    setEdit({ original: category, value: category[field] });
  };
  const discardEdit = () => {
    setEdit(undefined);
    setDiscarding(false);
    requestAnimationFrame(() => editTriggerRef.current?.focus());
  };
  if (edit)
    return (
      <div className='grid min-w-0 gap-2'>
        <FeedbackForm
          noValidate
          values={() => ({ value: edit.value })}
          savedValues={{ value: edit.original[field] }}
          error={error}
          errorContent={<CategoryError error={error} />}
          submitting={submission.submitting}
          className='grid min-w-0 gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {field === 'description' ? (
            <Textarea
              autoFocus
              value={edit.value}
              maxLength={2000}
              aria-label={label}
              disabled={submission.submitting}
              onChange={(event) =>
                setEdit({ ...edit, value: event.target.value })
              }
            />
          ) : (
            <Input
              ref={ref}
              autoFocus
              value={edit.value}
              required
              maxLength={field === 'code' ? 64 : 100}
              aria-label={label}
              disabled={submission.submitting}
              onChange={(event) =>
                setEdit({ ...edit, value: event.target.value })
              }
            />
          )}
          <div className='flex gap-2'>
            <PendingButton
              type='submit'
              size='sm'
              busy={submission.submitting}
              disabled={field !== 'description' && !edit.value.trim()}
            >
              <Check />
              {t('categoryManagement.save')}
            </PendingButton>
            <Button
              type='button'
              size='sm'
              variant='outline'
              disabled={submission.submitting}
              onClick={() => {
                if (edit.value !== edit.original[field]) setDiscarding(true);
                else discardEdit();
              }}
            >
              <X />
              {t('categoryManagement.cancel')}
            </Button>
          </div>
        </FeedbackForm>
        <ConfirmAction
          open={discarding}
          title={t('settings.discardTitle')}
          description={t('settings.discardHint')}
          busy={submission.submitting}
          onCancel={() => setDiscarding(false)}
          onConfirm={discardEdit}
        />
        {leave.dialog}
      </div>
    );
  if (!editable)
    return field === 'description' ? (
      <LongTextPreview label={label}>{value}</LongTextPreview>
    ) : (
      <span className='break-words'>{value}</span>
    );
  if (field === 'description')
    return (
      <div className='flex min-w-0 items-start gap-2'>
        <div className='min-w-0 flex-1'>
          <LongTextPreview label={label}>{value}</LongTextPreview>
        </div>
        <Button
          ref={editTriggerRef}
          variant='ghost'
          size='icon'
          aria-label={`${t('categoryManagement.edit')} ${label}`}
          onClick={beginEdit}
        >
          <Pencil className='size-3' />
        </Button>
      </div>
    );
  return (
    <Button
      ref={editTriggerRef}
      variant='ghost'
      className={`group h-auto min-h-8 min-w-0 max-w-full justify-start px-0 py-0 text-left whitespace-normal ${title ? 'font-heading text-2xl font-semibold tracking-tight' : 'font-normal'}`}
      title={t('categoryManagement.edit')}
      onClick={() => {
        setError(undefined);
        setEdit({ original: category, value: category[field] });
      }}
    >
      <span className='min-w-0 break-words'>{value}</span>
      <Pencil className='size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100' />
    </Button>
  );
}
