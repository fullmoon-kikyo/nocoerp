import system from './system/en-US.js';

const sharingRules = {
  ...system.settings.defaultAccess,
  none: 'Do not share',
  title: 'Sharing rules',
  description:
    'Share selected records with named people or teams who already hold the operation permission.',
  boundary:
    'Sharing adds data access only. It does not grant pages, operations, fields or related records. Restrictions still apply.',
  new: 'New sharing rule',
  edit: 'Sharing rule',
  name: 'Rule name',
  reason: 'Reason for sharing',
  search: 'Search rules or recipient IDs',
  noResources:
    'No business records are available to share yet. Add a business module with supported operations and data scopes first.',
  noResourcesShort: 'No shareable business data',
  recipients: 'Recipients',
  recipientType: 'Recipient type',
  recipientHint:
    'Choose specific people or registered teams. Review every recipient below before saving.',
  noRecipients: 'No recipients selected.',
  recipientCount: '{{count}} recipient(s)',
  searchRecipients: 'Search recipients',
  noMatches: 'No matches.',
  unresolved: 'Unavailable recipient; preserved until explicitly removed',
  removeRecipient: 'Remove recipient {{name}}',
  remove: 'Remove',
  previous: 'Previous',
  next: 'Next',
  page: 'Page {{page}} · {{total}} total',
  specificRecords: 'Select specific records',
  pickRecords: 'Choose records',
  selectedRecords: '{{count}} record(s) selected',
  removeRecord: 'Remove record {{id}}',
  actionsRequired:
    'Choose at least one operation and a nonempty record selection or supported data scope.',
  recipientsRequired: 'Choose at least one specific recipient.',
  delete: 'Revoke sharing',
  deleteTitle: 'Revoke “{{name}}”?',
  deleteHint:
    'Only this sharing rule will be removed. Other rules, role grants and independent access sources remain in effect.',
  deleted: 'Sharing “{{name}}” revoked.',
  saved: 'Sharing “{{name}}” saved.',
  unsupported:
    'This rule contains unavailable operations or unsupported selections. It is shown read-only to preserve its configuration.',
  changed:
    'This rule changed while you were editing. Reload the latest version before saving.',
  deleteChanged:
    'This rule changed. Review the latest version before revoking it.',
  duplicate: 'This rule key already exists. Choose another key.',
  back: 'Back to sharing rules',
};
export default sharingRules;
