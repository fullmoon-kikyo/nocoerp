import { FeedbackForm } from '#components/feedback-form';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useSubmission } from '@nocobase/app-client';
import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import {
  useCan,
  type AuthorizationOptionsResponse,
  type LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useResolvedPath,
} from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import {
  DefaultAccessEditor,
  type DefaultAccessScopeControl,
} from '#components/default-access-editor';
import { PermissionFilter } from '#components/permission-filter';
import { Button } from '#components/ui/button';
import { Alert, AlertDescription } from '#components/ui/alert';
import { SettingsError, SettingsLoading } from './shared.js';
import { useSettingsData, useSettingsLeave } from './hooks.js';
import { permissionFilterLabels } from './permission-filters.js';
import { permissionFilterFieldLabel } from './permission-workspace.js';
import {
  actionKey,
  resourceKey,
  ruleResources,
  ruleScopes,
  replaceRuleScope,
  editableRule,
  type ScopeSelection,
} from './default-access-model.js';
import {
  validSharingActions,
  sharingRuleChanges,
  type SharingRule,
} from './sharing-rules-model.js';
import { SharingSubjects, SharingRecords } from './sharing-rule-pickers.js';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Textarea } from '#components/ui/textarea';

function SharingRuleFormBody(): ReactElement {
  const { key } = useParams();
  const creating = key === undefined;
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const location = useLocation();
  const listPath = useResolvedPath('..').pathname;
  const parent = useOutletContext<{
    reload: () => void;
    saved: (rule: SharingRule) => void;
  }>();
  const rules = useSettingsData<{ data: readonly SharingRule[] }>(
    'authorization/sharingRules',
  );
  const catalog = useSettingsData<{ data: AuthorizationOptionsResponse }>(
    'authorization/sharingRules/options',
  );
  const canWrite = useCan({
    resource: { type: 'settings', id: 'authorization.sharing-rules' },
    action: creating ? 'create' : 'update',
  }).can;
  const [draft, setDraft] = useState<SharingRule>();
  const { session } = useAuthentication();
  const submission = useSubmission({
    scope: `${session?.user.id}:settings:sharing-rules:${key}`,
  });
  const [requestBusy, setRequestBusy] = useState(false);
  const busy = requestBusy || submission.submitting;
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState<string>();
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (message) messageRef.current?.focus();
  }, [message]);
  const [submitted, setSubmitted] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    key?: string;
    resource?: string;
  }>({});
  const [scopeErrors, setScopeErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string>();
  const formRef = useRef<HTMLFormElement>(null);
  const initial = creating
    ? undefined
    : rules.data?.data.find((rule) => rule.key === key);
  const value = draft ??
    initial ?? {
      key: '',
      resource: { type: '', id: '' },
      actions: [],
      subjects: [],
    };
  const dirty =
    draft !== undefined && JSON.stringify(draft) !== JSON.stringify(initial);
  const leave = useSettingsLeave(dirty, busy);
  const close = () => {
    void navigate(
      { pathname: listPath, search: location.search },
      { replace: true },
    );
  };
  const text = (value: LocalizedText): string =>
    typeof value === 'string'
      ? value
      : t(value.key, {
          ns: value.ns,
          defaultValue: value.defaultValue ?? value.key,
        });
  const resources = catalog.data ? ruleResources(catalog.data.data) : [];
  const resource = resources.find(
    (entry) => resourceKey(entry) === resourceKey(value.resource),
  );
  const scopes = catalog.data ? ruleScopes(resource, catalog.data.data) : [];
  const supported =
    scopes.length > 0 &&
    Boolean(
      creating ||
      (catalog.data && editableRule(value, scopes, catalog.data.data)),
    );
  const forbiddenSelection = value.actions.some(
    ({ selection }) =>
      selection.type === 'all' ||
      (selection.type === 'recordAccess' && selection.key === 'allRecords'),
  );
  const valid =
    supported && validSharingActions(value) && value.subjects.length > 0;
  const readOnly =
    !canWrite || busy || (!creating && (!supported || forbiddenSelection));
  const options = resources.map((entry) => ({
    value: resourceKey(entry),
    label: text(entry.title),
  }));
  if (
    !creating &&
    !options.some((option) => option.value === resourceKey(value.resource))
  )
    options.push({
      value: resourceKey(value.resource),
      label: value.resource.id,
    });
  const invalidKey =
    !value.key.trim() ||
    ['options', 'subjects', 'records'].includes(value.key.trim());
  const fieldLabels: Record<string, string> = {
    name: t('sharingRules.fieldLabels.name'),
    id: t('sharingRules.fieldLabels.id'),
  };
  const labels = {
    ...permissionFilterLabels((label, fallback) =>
      t(label, { defaultValue: fallback ?? label }),
    ),
    description: t('sharingRules.filterDescription'),
  };
  const controls: DefaultAccessScopeControl[] = scopes.map((scope) => {
    const selected = value.actions.find(
      (entry) => actionKey(entry) === scope.id,
    )?.selection;
    const selectedValue = selected ? JSON.stringify(selected) : '';
    const choices = [
      { value: '', label: t('sharingRules.none') },
      {
        value: JSON.stringify({ type: 'records', ids: [] }),
        label: t('sharingRules.specificRecords'),
      },
      ...scope.recordAccess
        .filter((preset) => preset !== 'allRecords')
        .map((preset) => ({
          value: JSON.stringify({ type: 'recordAccess', key: preset }),
          label: text(
            catalog.data?.data.recordAccess.find(
              (entry) => entry.key === preset,
            )?.title ?? preset,
          ),
        })),
    ];
    if (selected && !choices.some((choice) => choice.value === selectedValue))
      choices.push({
        value: selectedValue,
        label:
          selected.type === 'all'
            ? t('sharingRules.all')
            : selected.type === 'records'
              ? t('sharingRules.records', {
                  count: selected.ids.length,
                })
              : selected.key === 'customFilter'
                ? t('sharingRules.custom')
                : t('sharingRules.retained'),
      });
    const custom =
      selected?.type === 'recordAccess' && selected.key === 'customFilter';
    const params =
      custom && selected.params && typeof selected.params === 'object'
        ? (Reflect.get(selected.params, 'filter') as unknown)
        : undefined;
    return {
      id: scope.id,
      error: scopeErrors[scope.id],
      action: text(scope.actionTitle),
      actionId: scope.action,
      scope: text(scope.title),
      value: selectedValue,
      options: choices,
      configuration:
        selected?.type === 'records' ? (
          <SharingRecords
            key={`${resourceKey(value.resource)}:${scope.id}`}
            collection={scope.collection}
            ids={selected.ids}
            readOnly={readOnly}
            onChange={(ids) =>
              setDraft(replaceRuleScope(value, scope, { type: 'records', ids }))
            }
          />
        ) : custom || editing === scope.id ? (
          <PermissionFilter
            open={editing === scope.id}
            onOpenChange={(open) => setEditing(open ? scope.id : undefined)}
            value={params}
            fields={scope.fields.map((field) => ({
              value: field,
              label:
                fieldLabels[field] ??
                permissionFilterFieldLabel(
                  scope.collection,
                  field,
                  (key, fallback) => t(key, { defaultValue: fallback ?? key }),
                ),
            }))}
            labels={labels}
            disabled={readOnly}
            onApply={(filter) => {
              setDraft(
                replaceRuleScope(value, scope, {
                  type: 'recordAccess',
                  key: 'customFilter',
                  params: { filter },
                }),
              );
              setScopeErrors((old) => ({ ...old, [scope.id]: '' }));
              setEditing(undefined);
            }}
          />
        ) : undefined,
    };
  });
  // Never discard entries no longer present in the live plugin catalog.
  for (const action of value.actions)
    if (!scopes.some((scope) => scope.id === actionKey(action)))
      controls.push({
        id: actionKey(action),
        action: action.action,
        actionId: action.action,
        scope: action.scopeKey ?? value.resource.id,
        value: JSON.stringify(action.selection),
        options: [
          {
            value: JSON.stringify(action.selection),
            label: t('sharingRules.retained'),
          },
        ],
      });
  const save = async () => {
    setSubmitted(true);
    if (!validSharingActions(value))
      setMessage(t('sharingRules.actionsRequired'));
    else if (!value.subjects.length)
      setMessage(t('sharingRules.recipientsRequired'));
    setFieldErrors({});
    setScopeErrors({});
    setError(undefined);
    if (valid && !invalidKey) setMessage(undefined);
    if (
      invalidKey ||
      !resource ||
      !valid ||
      forbiddenSelection ||
      !canWrite ||
      busy
    ) {
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    setRequestBusy(true);
    try {
      const saved = await submission.run(
        { creating, key, value },
        async (idempotencyKey, _signal, _snapshot, recovering) => {
          if (!creating && !recovering) {
            const latest = await api.request<{
              data: readonly SharingRule[];
            }>({ path: 'authorization/sharingRules' });
            if (
              JSON.stringify(latest.data.find((rule) => rule.key === key)) !==
              JSON.stringify(initial)
            ) {
              setMessage(t('sharingRules.changed'));
              return undefined;
            }
          }
          return api.request<{ data: SharingRule }>({
            path: creating
              ? 'authorization/sharingRules'
              : `authorization/sharingRules/${encodeURIComponent(key ?? '')}`,
            headers: { 'Idempotency-Key': idempotencyKey },
            method: creating ? 'POST' : 'PATCH',
            json: creating
              ? { ...value, key: value.key.trim() }
              : sharingRuleChanges(initial!, value),
          });
        },
      );
      if (!saved) return;
      toaster.show({
        type: 'success',
        title: t('sharingRules.saved', { name: value.key }),
      });
      leave.allow();
      parent.saved(saved.data);
      close();
    } catch (next) {
      if (
        next instanceof ApiClientError &&
        next.payload &&
        typeof next.payload === 'object'
      ) {
        const detail: unknown = Reflect.get(next.payload, 'error');
        const violations: unknown =
          detail && typeof detail === 'object'
            ? Reflect.get(detail, 'fieldViolations')
            : undefined;
        if (Array.isArray(violations)) {
          const errors: { key?: string; resource?: string } = {};
          const scopeErrors: Record<string, string> = {};
          for (const violation of violations) {
            const field: unknown =
              violation && typeof violation === 'object'
                ? Reflect.get(violation, 'field')
                : undefined;
            if (field === 'key') errors.key = t('sharingRules.keyRequired');
            else if (typeof field === 'string' && field.startsWith('resource'))
              errors.resource = t('sharingRules.resourceRequired');
            else if (typeof field === 'string') {
              const index = /^actions\.(\d+)(?:\.|$)/.exec(field);
              const entry = index ? value.actions[Number(index[1])] : undefined;
              if (entry)
                scopeErrors[actionKey(entry)] = t('sharingRules.scopeInvalid');
            }
          }
          setFieldErrors(errors);
          setScopeErrors(scopeErrors);
          requestAnimationFrame(() =>
            formRef.current
              ?.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus(),
          );
        }
      }
      const reason: unknown =
        next && typeof next === 'object'
          ? Reflect.get(next, 'reason')
          : undefined;
      if (
        reason === 'DEFAULT_ACCESS_CONFLICT' ||
        reason === 'RULE_ALREADY_EXISTS'
      )
        setMessage(t('sharingRules.duplicate'));
      else if (
        reason === 'INVALID_AUTHORIZATION_INPUT' ||
        reason === 'INVALID_INPUT'
      )
        setMessage(t('sharingRules.invalid'));
      else setError(next);
    } finally {
      setRequestBusy(false);
    }
  };
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t(creating ? 'sharingRules.new' : 'sharingRules.edit')}
        description={t('sharingRules.description')}
      />
      <SettingsError
        error={rules.error || catalog.error}
        retry={() => {
          rules.reload();
          catalog.reload();
        }}
      />
      {(rules.loading && !rules.data) || (catalog.loading && !catalog.data) ? (
        <SettingsLoading />
      ) : (
        !rules.error &&
        !catalog.error && (
          <>
            {!creating && !initial ? (
              <p role='status'>{t('settings.missing')}</p>
            ) : (
              <FeedbackForm
                submitting={busy}
                error={error}
                errorContent={<SettingsError error={error} inline />}
                ref={formRef}
                noValidate
                className='flex flex-col gap-6'
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                {message && (
                  <Alert variant='destructive' ref={messageRef} tabIndex={-1}>
                    <AlertDescription>
                      {message}
                      {!creating && (
                        <Button
                          type='button'
                          variant='outline'
                          onClick={() => {
                            setDraft(undefined);
                            setMessage(undefined);
                            rules.reload();
                          }}
                        >
                          {t('sharingRules.reload')}
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {!creating && (!supported || forbiddenSelection) && (
                  <p className='text-sm text-muted-foreground'>
                    {t('sharingRules.unsupported')}
                  </p>
                )}
                {creating && !options.length && (
                  <p className='text-sm text-muted-foreground'>
                    {t('sharingRules.noResources')}
                  </p>
                )}
                <div className='grid gap-2'>
                  <Label htmlFor='sharing-title'>
                    {t('sharingRules.name')}
                  </Label>
                  <Input
                    id='sharing-title'
                    disabled={readOnly}
                    value={
                      typeof value.title === 'string'
                        ? value.title
                        : value.title
                          ? text(value.title)
                          : ''
                    }
                    onChange={(event) =>
                      setDraft({ ...value, title: event.target.value })
                    }
                  />
                </div>
                <DefaultAccessEditor
                  ruleKey={value.key}
                  resource={
                    value.resource.type ? resourceKey(value.resource) : ''
                  }
                  resources={options}
                  scopes={controls}
                  existing={!creating}
                  readOnly={readOnly}
                  keyError={
                    submitted && invalidKey
                      ? t('sharingRules.keyRequired')
                      : fieldErrors.key
                  }
                  resourceError={
                    submitted && !resource
                      ? t('sharingRules.resourceRequired')
                      : fieldErrors.resource
                  }
                  labels={{
                    key: t('settings.key'),
                    resource: t('sharingRules.resource'),
                    chooseResource: t('sharingRules.chooseResource'),
                    action: t('sharingRules.action'),
                    scope: t('sharingRules.scope'),
                    noScopes: t('sharingRules.chooseResource'),
                  }}
                  onKeyChange={(key) => {
                    setDraft({ ...value, key });
                    setFieldErrors((old) => {
                      const { key: _key, ...next } = old;
                      return next;
                    });
                  }}
                  onResourceChange={(selected) => {
                    const resource = resources.find(
                      (entry) => resourceKey(entry) === selected,
                    );
                    if (resource) {
                      setDraft({
                        ...value,
                        resource: { type: resource.type, id: resource.id },
                        actions: [],
                      });
                      setEditing(undefined);
                      setFieldErrors({});
                      setScopeErrors({});
                    }
                  }}
                  onScopeChange={(id, next) => {
                    const scope = scopes.find((scope) => scope.id === id);
                    if (!scope) return;
                    setScopeErrors((old) => ({ ...old, [id]: '' }));
                    const selection = next
                      ? (JSON.parse(next) as ScopeSelection)
                      : undefined;
                    if (
                      selection?.type === 'recordAccess' &&
                      selection.key === 'customFilter' &&
                      !('params' in selection)
                    )
                      setEditing(id);
                    else setDraft(replaceRuleScope(value, scope, selection));
                  }}
                />
                {catalog.data && (
                  <SharingSubjects
                    catalog={catalog.data.data}
                    value={value.subjects}
                    readOnly={readOnly}
                    onChange={(subjects) => setDraft({ ...value, subjects })}
                  />
                )}
                <div className='grid gap-2'>
                  <Label htmlFor='sharing-reason'>
                    {t('sharingRules.reason')}
                  </Label>
                  <Textarea
                    id='sharing-reason'
                    disabled={readOnly}
                    value={value.reason ?? ''}
                    onChange={(event) =>
                      setDraft({ ...value, reason: event.target.value })
                    }
                  />
                </div>
                <div className='flex justify-end gap-2 border-t pt-4'>
                  <Button
                    type='button'
                    variant='outline'
                    disabled={busy}
                    onClick={() => {
                      void Promise.resolve(leave.guard()).then((allowed) => {
                        if (allowed) close();
                      });
                    }}
                  >
                    {t('settings.cancel')}
                  </Button>
                  {canWrite && (
                    <Button
                      type='submit'
                      disabled={
                        busy || !dirty || !supported || forbiddenSelection
                      }
                    >
                      {t(busy ? 'settings.saving' : 'settings.save')}
                    </Button>
                  )}
                </div>
              </FeedbackForm>
            )}
            {!creating && !initial && (
              <Button variant='outline' onClick={close}>
                {t('sharingRules.back')}
              </Button>
            )}
          </>
        )
      )}
      {leave.dialog}
    </PageContainer>
  );
}
export default function SharingRuleForm(): ReactElement {
  const { key } = useParams();
  return (
    <RouteChildPage>
      <SharingRuleFormBody key={key ?? 'create'} />
    </RouteChildPage>
  );
}
