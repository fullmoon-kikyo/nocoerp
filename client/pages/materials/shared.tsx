import type { ReactElement } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { SettingsError } from '../settings/shared.js';

export function MaterialError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const key =
    error instanceof ApiClientError
      ? error.reason === 'MATERIAL_CODE_EXISTS'
        ? 'materials.duplicate'
        : error.reason === 'CATEGORY_UNAVAILABLE'
          ? 'materials.categoryUnavailable'
          : error.reason === 'VERSION_CONFLICT'
            ? 'materials.versionConflict'
            : undefined
      : undefined;
  if (!key) return <SettingsError error={error} retry={retry} />;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {t(key)}
        {retry && (
          <Button type='button' variant='outline' onClick={retry}>
            {t('materials.reload')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
