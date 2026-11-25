import type {
  AuthorizationSubject,
  LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import type { DefaultAccessRule } from './default-access-model.js';

/** Uses the plugin's full rule shape; no permission assignments are written by this editor. */
export interface SharingRule extends DefaultAccessRule {
  readonly title?: LocalizedText;
  readonly reason?: string;
  readonly subjects: readonly AuthorizationSubject[];
}
export const subjectKey = (subject: AuthorizationSubject): string =>
  JSON.stringify([subject.type, subject.id]);

/** PATCH only changed properties so an untouched scope or recipient is never rewritten. */
export function sharingRuleChanges(initial: SharingRule, draft: SharingRule) {
  return {
    ...(JSON.stringify(initial.actions) !== JSON.stringify(draft.actions)
      ? { actions: draft.actions }
      : {}),
    ...(JSON.stringify(initial.subjects) !== JSON.stringify(draft.subjects)
      ? { subjects: draft.subjects }
      : {}),
    ...(JSON.stringify(initial.title) !== JSON.stringify(draft.title)
      ? { title: draft.title || null }
      : {}),
    ...(initial.reason !== draft.reason
      ? { reason: draft.reason?.trim() || null }
      : {}),
  };
}

export function validSharingActions(rule: SharingRule): boolean {
  return (
    rule.actions.length > 0 &&
    rule.actions.every(({ selection }) =>
      selection.type === 'records'
        ? selection.ids.length > 0
        : selection.type === 'recordAccess' && selection.key !== 'allRecords',
    )
  );
}
