import { useEffect, useRef, useState, type ReactElement } from 'react';
import { History, MessageSquare, Pencil, Send } from 'lucide-react';
import {
  resolveListState,
  useApiClient,
  useSubmission,
} from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useListData } from '#hooks/use-list-data';
import { FeedbackForm } from '#components/feedback-form';
import { LongText } from '#components/long-text';
import { Button } from '#components/ui/button';
import { Textarea } from '#components/ui/textarea';
import { PendingButton } from '#components/pending-button';
import { RefreshIndicator } from '#components/loading';
import { ListFeedback, ListFeedbackActions } from '#components/list-feedback';
import { RowActions } from '#components/row-actions';
import { ConfirmAction } from '../../settings/shared.js';
import { useSettingsLeave } from '../../settings/hooks.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';
import type { CategoryEvent } from '../../../../shared/material-categories.js';
import { CategoryError } from './shared.js';

export function CategoryHistory({
  id,
  categories,
  params,
  active,
  revision,
  canComment,
  onQuery,
}: {
  id: string;
  categories: readonly MaterialCategory[];
  params: URLSearchParams;
  active: boolean;
  revision: number;
  canComment: boolean;
  onQuery: (values: Record<string, string | undefined>) => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const { session } = useAuthentication();
  const rawPage = Number(params.get('historyPage'));
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const filter = ['comments', 'changes'].includes(
    params.get('historyFilter') ?? '',
  )
    ? params.get('historyFilter')!
    : 'all';
  const history = useListData<{
    data: CategoryEvent[];
    meta: { total: number };
  }>(
    `materialMaster/categories/${id}/history?${new URLSearchParams({ page: String(page), pageSize: '20', filter })}`,
    { active },
  );
  const listState = resolveListState(
    {
      data: history.data?.data,
      error: history.error,
      isPending: !history.data && history.loading,
    },
    history.data?.data.length ?? 0,
    filter !== 'all',
  );
  const listAvailable = [
    'ready',
    'empty',
    'no-results',
    'refresh-failed',
  ].includes(listState);
  const { reload: reloadHistory } = history;
  const seenRevisionRef = useRef(revision);
  useEffect(() => {
    if (seenRevisionRef.current !== revision) {
      seenRevisionRef.current = revision;
      reloadHistory();
    }
  }, [revision, reloadHistory]);
  const [body, setBody] = useState('');
  const [replyTo, setReplyTo] = useState<CategoryEvent>();
  const [editing, setEditing] = useState<{
    event: CategoryEvent;
    body: string;
  }>();
  const [removing, setRemoving] = useState<CategoryEvent>();
  const [error, setError] = useState<unknown>();
  const [discardingEdit, setDiscardingEdit] = useState(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const create = useSubmission({
    scope: `${session?.user.id}:categories:${id}:comments:create`,
  });
  const edit = useSubmission({
    scope: `${session?.user.id}:categories:${id}:comments:${editing?.event.id ?? ''}:edit`,
  });
  const remove = useSubmission({
    scope: `${session?.user.id}:categories:${id}:comments:${removing?.id ?? ''}:delete`,
  });
  const leave = useSettingsLeave(
    Boolean(body.trim() || (editing && editing.body !== editing.event.body)),
    create.submitting || edit.submitting || remove.submitting,
  );
  const submit = async () => {
    if (!canComment || !body.trim()) return;
    setError(undefined);
    try {
      const result = await create.run(
        { body, replyToId: replyTo?.id },
        (key, signal, snapshot) =>
          api.request({
            path: `materialMaster/categories/${id}/comments`,
            method: 'POST',
            headers: { 'Idempotency-Key': key },
            signal,
            json: snapshot,
          }),
      );
      if (result) {
        setBody('');
        setReplyTo(undefined);
        history.reload();
        composerRef.current?.focus();
      }
    } catch (next) {
      setError(next);
    }
  };
  const saveEdit = async () => {
    if (!editing || !canComment || !editing.body.trim()) return;
    setError(undefined);
    try {
      const result = await edit.run(editing, (key, signal, snapshot) =>
        api.request({
          path: `materialMaster/categories/${id}/comments/${snapshot.event.id}`,
          method: 'PATCH',
          headers: { 'Idempotency-Key': key },
          signal,
          json: {
            body: snapshot.body,
            expectedVersion: snapshot.event.version,
          },
        }),
      );
      if (result) {
        setEditing(undefined);
        history.reload();
      }
    } catch (next) {
      setError(next);
    }
  };
  const deleteComment = async () => {
    if (!removing) return;
    setError(undefined);
    try {
      const result = await remove.run(removing, (key, signal, snapshot) =>
        api.request({
          path: `materialMaster/categories/${id}/comments/${snapshot.id}`,
          method: 'DELETE',
          headers: { 'Idempotency-Key': key },
          signal,
          json: { expectedVersion: snapshot.version },
        }),
      );
      if (result) {
        setRemoving(undefined);
        history.reload();
        composerRef.current?.focus();
      }
    } catch (next) {
      setError(next);
    }
  };
  const when = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const value = (field: string, raw: unknown): string =>
    field === 'parentId'
      ? (categories.find((row) => row.id === raw)?.name ?? '—')
      : raw == null || raw === ''
        ? '—'
        : typeof raw === 'string' ||
            typeof raw === 'number' ||
            typeof raw === 'boolean'
          ? String(raw)
          : '—';
  return (
    <div className='relative grid min-w-0 gap-4'>
      <RefreshIndicator
        pending={
          active && history.loading && Boolean(history.data) && listAvailable
        }
        identity={`${id}:history`}
      />
      {canComment && listAvailable && (
        <FeedbackForm
          noValidate
          values={() => ({ body, replyToId: replyTo?.id })}
          savedValues={{ body: '', replyToId: undefined }}
          submitting={create.submitting}
          className='grid gap-2'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {replyTo && (
            <div className='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
              <span>
                {t('categoryManagement.replying', {
                  name:
                    replyTo.actorName || t('categoryManagement.originalActor'),
                })}
              </span>
              <Button
                type='button'
                variant='ghost'
                size='sm'
                onClick={() => setReplyTo(undefined)}
              >
                {t('categoryManagement.cancelReply')}
              </Button>
            </div>
          )}
          <div className='flex min-w-0 items-start gap-2'>
            <span className='flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground'>
              {(session?.user.name ?? '').slice(0, 2)}
            </span>
            <Textarea
              ref={composerRef}
              rows={2}
              value={body}
              maxLength={2000}
              placeholder={t('categoryManagement.writeComment')}
              aria-label={t('categoryManagement.writeComment')}
              disabled={create.submitting}
              onChange={(event) => setBody(event.target.value)}
              className='min-h-16'
            />
          </div>
          {body.trim() && (
            <div className='flex justify-end'>
              <PendingButton type='submit' busy={create.submitting}>
                <Send />
                {t('categoryManagement.postComment')}
              </PendingButton>
            </div>
          )}
        </FeedbackForm>
      )}
      <div
        role='group'
        aria-label={t('categoryManagement.history')}
        className='flex gap-1'
      >
        {(['all', 'comments', 'changes'] as const).map((key) => (
          <Button
            key={key}
            variant={filter === key ? 'secondary' : 'ghost'}
            size='sm'
            aria-pressed={filter === key}
            onClick={() =>
              onQuery({
                historyFilter: key === 'all' ? undefined : key,
                historyPage: undefined,
              })
            }
          >
            {t(`categoryManagement.${key}`)}
          </Button>
        ))}
      </div>
      {!removing && <CategoryError error={error} />}
      <ListFeedbackActions
        state={listState}
        onRetry={history.reload}
        busy={active && history.loading}
      />
      <ListFeedback state={listState} identity={`${id}:history`}>
        <ol className='grid min-w-0 gap-5'>
          {(history.data?.data ?? []).map((event) => (
            <li
              key={event.id}
              className={`grid min-w-0 gap-2 ${event.replyToId ? 'ml-3 border-l pl-3 sm:ml-5' : ''}`}
            >
              <div className='flex min-w-0 items-start gap-2'>
                <span className='pt-1 text-muted-foreground'>
                  {event.kind === 'comment' ? (
                    <MessageSquare className='size-4' />
                  ) : event.kind === 'initial' ? (
                    <History className='size-4' />
                  ) : (
                    <Pencil className='size-4' />
                  )}
                </span>
                <div className='min-w-0 flex-1'>
                  <div className='flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground'>
                    <span>
                      {event.actorName || t('categoryManagement.originalActor')}{' '}
                      ·{' '}
                      {event.replyToId
                        ? t('categoryManagement.replyMarker')
                        : t(`categoryManagement.${event.kind}`)}
                      {event.editedAt
                        ? ` · ${t('categoryManagement.edited')}`
                        : ''}
                    </span>
                    <time dateTime={event.createdAt}>
                      {when(event.createdAt)}
                    </time>
                  </div>
                  {editing?.event.id === event.id ? (
                    <FeedbackForm
                      noValidate
                      values={() => ({ body: editing.body })}
                      savedValues={{ body: editing.event.body ?? '' }}
                      submitting={edit.submitting}
                      className='mt-2 grid gap-2'
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit();
                      }}
                    >
                      <Textarea
                        aria-label={t('categoryManagement.editComment')}
                        value={editing.body}
                        maxLength={2000}
                        disabled={edit.submitting}
                        onChange={(e) =>
                          setEditing({ ...editing, body: e.target.value })
                        }
                      />
                      <div className='flex gap-2'>
                        <PendingButton
                          type='submit'
                          busy={edit.submitting}
                          disabled={!editing.body.trim()}
                        >
                          {t('categoryManagement.save')}
                        </PendingButton>
                        <Button
                          type='button'
                          variant='outline'
                          disabled={edit.submitting}
                          onClick={() => {
                            if (editing.body !== editing.event.body)
                              setDiscardingEdit(true);
                            else setEditing(undefined);
                          }}
                        >
                          {t('categoryManagement.cancel')}
                        </Button>
                      </div>
                    </FeedbackForm>
                  ) : event.kind === 'comment' ? (
                    <div className='mt-2 text-sm'>
                      <LongText>
                        {event.deletedAt
                          ? t('categoryManagement.deletedComment')
                          : event.body}
                      </LongText>
                    </div>
                  ) : (
                    event.changes && (
                      <dl className='mt-2 grid gap-1 text-xs text-muted-foreground'>
                        {Object.entries(event.changes)
                          .filter(([field]) => field !== 'sortOrder')
                          .map(([field, change]) => (
                            <div
                              className='flex min-w-0 flex-wrap gap-1'
                              key={field}
                            >
                              <dt>
                                {t(
                                  `categoryManagement.${field === 'parentId' ? 'parent' : field}`,
                                )}
                                :
                              </dt>
                              <dd className='min-w-0 break-words'>
                                {value(field, change.before)} →{' '}
                                {value(field, change.after)}
                              </dd>
                            </div>
                          ))}
                      </dl>
                    )
                  )}
                </div>
                {event.kind === 'comment' && !event.deletedAt && canComment && (
                  <RowActions
                    label={t('categoryManagement.actions')}
                    actions={[
                      !event.replyToId && {
                        key: 'reply',
                        label: t('categoryManagement.reply'),
                        onClick: () => {
                          setReplyTo(event);
                          composerRef.current?.focus();
                        },
                      },
                      event.actorId === session?.user.id && {
                        key: 'edit',
                        label: t('categoryManagement.editComment'),
                        onClick: () => {
                          setError(undefined);
                          setEditing({ event, body: event.body ?? '' });
                        },
                      },
                      event.actorId === session?.user.id && {
                        key: 'delete',
                        label: t('categoryManagement.deleteComment'),
                        destructive: true,
                        onClick: () => {
                          setError(undefined);
                          setRemoving(event);
                        },
                      },
                    ]}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      </ListFeedback>
      {listAvailable && (history.data?.meta.total ?? 0) > 20 && (
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            disabled={page <= 1 || history.loading}
            onClick={() => onQuery({ historyPage: String(page - 1) })}
          >
            {t('categoryManagement.previous')}
          </Button>
          <span className='text-xs text-muted-foreground'>
            {t('categoryManagement.page', { page })}
          </span>
          <Button
            variant='outline'
            size='sm'
            disabled={
              page * 20 >= (history.data?.meta.total ?? 0) || history.loading
            }
            onClick={() => onQuery({ historyPage: String(page + 1) })}
          >
            {t('categoryManagement.next')}
          </Button>
        </div>
      )}
      <ConfirmAction
        open={Boolean(removing)}
        title={t('categoryManagement.commentDeleteTitle', {
          name: removing?.actorName || t('categoryManagement.originalActor'),
        })}
        description={t('categoryManagement.commentDeleteHint', {
          body:
            Array.from(removing?.body ?? '')
              .slice(0, 80)
              .join('') + ((removing?.body?.length ?? 0) > 80 ? '…' : ''),
        })}
        confirmLabel={t('categoryManagement.deleteComment')}
        busy={remove.submitting}
        error={<CategoryError error={error} />}
        onCancel={() => {
          setRemoving(undefined);
          setError(undefined);
        }}
        onConfirm={() => {
          void deleteComment();
        }}
      />
      <ConfirmAction
        open={discardingEdit}
        title={t('settings.discardTitle')}
        description={t('settings.discardHint')}
        busy={edit.submitting}
        onCancel={() => setDiscardingEdit(false)}
        onConfirm={() => {
          setEditing(undefined);
          setDiscardingEdit(false);
          composerRef.current?.focus();
        }}
      />
      {leave.dialog}
    </div>
  );
}
