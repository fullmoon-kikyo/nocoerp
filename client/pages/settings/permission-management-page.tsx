import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from '@nocobase/i18n/client';

import { SettingsModulePage } from './settings-module-page.js';

/** Roles, default scopes and sharing rules share one permission-management module. */
export function PermissionManagementPage({
  tab,
  actions,
  children,
}: {
  tab: 'roles' | 'default-access' | 'sharing-rules';
  actions?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <SettingsModulePage
      title={t('settings.permissionManagement')}
      description={t(
        tab === 'roles'
          ? 'settings.rolesDescription'
          : tab === 'sharing-rules'
            ? 'sharingRules.description'
            : 'settings.defaultAccess.description',
      )}
      actions={actions}
    >
      {children}
    </SettingsModulePage>
  );
}
