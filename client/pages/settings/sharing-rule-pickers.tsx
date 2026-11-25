import { useEffect, useState, type ReactElement } from 'react';
import { useApiClient } from '@nocobase/app-client';
import type {
  AuthorizationOptionsResponse,
  AuthorizationRecordOption,
  AuthorizationSubject,
  LocalizedText,
  SubjectOption,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Input } from '#components/ui/input';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { useSettingsData } from './hooks.js';
import { SettingsError, SettingsLoading } from './shared.js';
import { subjectKey } from './sharing-rules-model.js';

function useSharingText() {
  const { t } = useTranslation();
  return (value: LocalizedText): string =>
    typeof value === 'string'
      ? value
      : t(value.key, {
          ns: value.ns,
          defaultValue: value.defaultValue ?? value.key,
        });
}

function Pages({
  page,
  total,
  busy,
  onChange,
}: {
  page: number;
  total: number;
  busy: boolean;
  onChange: (page: number) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={busy || page <= 1}
        onClick={() => onChange(page - 1)}
      >
        {t('sharingRules.previous')}
      </Button>
      <span className='text-sm text-muted-foreground'>
        {t('sharingRules.page', { page, total })}
      </span>
      <Button
        type='button'
        variant='outline'
        size='sm'
        disabled={busy || page * 20 >= total}
        onClick={() => onChange(page + 1)}
      >
        {t('sharingRules.next')}
      </Button>
    </div>
  );
}

/** Resolves every selected subject through the same protected management surface. */
function SelectedSubjects({
  type,
  ids,
  readOnly,
  onRemove,
}: {
  type: string;
  ids: readonly string[];
  readOnly: boolean;
  onRemove: (id: string) => void;
}): ReactElement {
  const api = useApiClient();
  const text = useSharingText();
  const { t } = useTranslation();
  const [result, setResult] = useState<{
    key: string;
    items?: readonly SubjectOption[];
    error?: unknown;
  }>();
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify(ids);
  useEffect(() => {
    const controller = new AbortController();
    void api
      .request<{ data: readonly SubjectOption[] }>({
        path: `authorization/sharingRules/subjects/${encodeURIComponent(type)}/resolve`,
        method: 'POST',
        json: { ids: JSON.parse(key) as string[] },
        signal: controller.signal,
      })
      .then(
        (response) => {
          if (!controller.signal.aborted)
            setResult({ key, items: response.data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted) setResult({ key, error });
        },
      );
    return () => controller.abort();
  }, [api, key, type, revision]);
  const current = result?.key === key ? result : undefined;
  return (
    <div className='grid min-w-0 gap-2'>
      {!current && <SettingsLoading />}
      <SettingsError
        error={current?.error}
        retry={() => setRevision((value) => value + 1)}
      />
      {ids.map((id) => {
        const subject = current?.items?.find((item) => item.id === id);
        return (
          <div
            key={id}
            className='flex min-w-0 items-center justify-between gap-2 rounded-md border p-2'
          >
            <div className='min-w-0 text-sm break-words'>
              <span className='font-medium'>
                {subject ? text(subject.title) : id}
              </span>
              <span className='block text-xs text-muted-foreground'>
                {type} · {id}
                {current?.items && !subject
                  ? ` · ${t('sharingRules.unresolved')}`
                  : ''}
              </span>
              {subject?.description && (
                <span className='block text-muted-foreground'>
                  {text(subject.description)}
                </span>
              )}
            </div>
            {!readOnly && (
              <Button
                type='button'
                variant='ghost'
                size='sm'
                aria-label={t('sharingRules.removeRecipient', {
                  name: subject ? text(subject.title) : id,
                })}
                onClick={() => onRemove(id)}
              >
                {t('sharingRules.remove')}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function SharingSubjects({
  catalog,
  value,
  readOnly,
  onChange,
}: {
  catalog: AuthorizationOptionsResponse;
  value: readonly AuthorizationSubject[];
  readOnly: boolean;
  onChange: (value: readonly AuthorizationSubject[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const text = useSharingText();
  // Fixed subjects such as authenticated:* are deliberately not a recipient choice.
  const types = catalog.subjectTypes.filter(
    (entry) => entry.selection.type === 'collection',
  );
  const [chosenType, setChosenType] = useState<string>();
  const type = chosenType ?? types[0]?.type;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const directory = useSettingsData<{
    data: readonly SubjectOption[];
    meta: { total: number };
  }>(
    `authorization/sharingRules/subjects/${encodeURIComponent(type ?? '')}?${new URLSearchParams({ q: search, page: String(page), pageSize: '20' })}`,
    { active: Boolean(type) && !readOnly },
  );
  const groups = [...new Set(value.map((subject) => subject.type))];
  return (
    <section
      className='grid min-w-0 gap-3'
      aria-label={t('sharingRules.recipients')}
    >
      <h3 className='text-sm font-medium'>{t('sharingRules.recipients')} *</h3>
      <p className='text-sm text-muted-foreground'>
        {t('sharingRules.recipientHint')}
      </p>
      {groups.map((type) => (
        <SelectedSubjects
          key={type}
          type={type}
          ids={value
            .filter((item) => item.type === type)
            .map((item) => item.id)}
          readOnly={readOnly}
          onRemove={(id) =>
            onChange(
              value.filter((item) => item.type !== type || item.id !== id),
            )
          }
        />
      ))}
      {!value.length && (
        <p className='text-sm text-muted-foreground'>
          {t('sharingRules.noRecipients')}
        </p>
      )}
      {!readOnly && (
        <>
          <div className='grid gap-2 sm:grid-cols-2'>
            <Select
              value={type ?? ''}
              items={types.map((entry) => ({
                value: entry.type,
                label: text(entry.title),
              }))}
              onValueChange={(next) => {
                if (next) {
                  setChosenType(next);
                  setPage(1);
                  setSearch('');
                }
              }}
            >
              <SelectTrigger
                className='w-full'
                aria-label={t('sharingRules.recipientType')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {types.map((entry) => (
                  <SelectItem key={entry.type} value={entry.type}>
                    {text(entry.title)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              aria-label={t('sharingRules.searchRecipients')}
              placeholder={t('sharingRules.searchRecipients')}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <SettingsError error={directory.error} retry={directory.reload} />
          {directory.loading && <SettingsLoading />}
          {!directory.error && directory.data && (
            <>
              <div className='grid max-h-64 gap-2 overflow-y-auto rounded-md border p-3'>
                {directory.data.data.map((item) => {
                  const subject = { type, id: item.id };
                  const selected = value.some(
                    (entry) => subjectKey(entry) === subjectKey(subject),
                  );
                  return (
                    <Label
                      key={item.id}
                      className='flex min-w-0 items-start gap-3 py-1'
                    >
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(checked) =>
                          onChange(
                            checked
                              ? [...value, subject]
                              : value.filter(
                                  (entry) =>
                                    subjectKey(entry) !== subjectKey(subject),
                                ),
                          )
                        }
                      />
                      <span className='min-w-0 text-sm break-words'>
                        {text(item.title)}
                        <span className='block text-xs text-muted-foreground'>
                          {item.description ? text(item.description) : item.id}
                        </span>
                      </span>
                    </Label>
                  );
                })}
                {!directory.data.data.length && (
                  <p className='text-sm text-muted-foreground'>
                    {t('sharingRules.noMatches')}
                  </p>
                )}
              </div>
              <Pages
                page={page}
                total={directory.data.meta.total}
                busy={directory.loading}
                onChange={setPage}
              />
            </>
          )}
        </>
      )}
    </section>
  );
}

export function SharingRecords({
  collection,
  ids,
  readOnly,
  onChange,
}: {
  collection: string;
  ids: readonly string[];
  readOnly: boolean;
  onChange: (ids: readonly string[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const records = useSettingsData<{
    data: readonly AuthorizationRecordOption[];
    meta: { total: number };
  }>(
    `authorization/sharingRules/records/${encodeURIComponent(collection)}?page=${page}&pageSize=20`,
  );
  return (
    <div
      className='grid min-w-0 gap-2'
      aria-label={t('sharingRules.pickRecords')}
    >
      <p className='text-xs text-muted-foreground'>
        {t('sharingRules.selectedRecords', { count: ids.length })}
      </p>
      <div className='flex min-w-0 flex-wrap gap-2'>
        {ids.map((id) => (
          <Button
            key={id}
            type='button'
            variant='outline'
            size='sm'
            disabled={readOnly}
            className='max-w-full'
            aria-label={t('sharingRules.removeRecord', { id })}
            onClick={() => onChange(ids.filter((entry) => entry !== id))}
          >
            <span className='truncate'>
              {records.data?.data.find((entry) => entry.id === id)?.label ?? id}
            </span>{' '}
            ×
          </Button>
        ))}
      </div>
      <SettingsError error={records.error} retry={records.reload} />
      {records.loading && <SettingsLoading />}
      {!records.error && records.data && (
        <>
          <div className='grid max-h-56 gap-2 overflow-y-auto rounded-md border p-3'>
            {records.data.data.map((record) => (
              <Label
                key={record.id}
                className='flex min-w-0 items-start gap-3 py-1'
              >
                <Checkbox
                  disabled={readOnly}
                  checked={ids.includes(record.id)}
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [...ids, record.id]
                        : ids.filter((id) => id !== record.id),
                    )
                  }
                />
                <span className='min-w-0 text-sm break-words'>
                  {record.label}
                  <span className='block text-xs text-muted-foreground'>
                    {record.description ?? record.id}
                  </span>
                </span>
              </Label>
            ))}
            {!records.data.data.length && (
              <p className='text-sm text-muted-foreground'>
                {t('sharingRules.noMatches')}
              </p>
            )}
          </div>
          <Pages
            page={page}
            total={records.data.meta.total}
            busy={records.loading}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
