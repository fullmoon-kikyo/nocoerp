import type { ReactElement } from 'react';
import { ApiClientError } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Button } from '#components/ui/button';
import { MaterialError } from '../shared.js';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';

export interface CategoryPageContext {
  categories: readonly MaterialCategory[];
  reload: () => void;
  selectCategory: (id: string) => void;
  categorySelectionParam: 'selected';
}
export function CategoryError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const reasons: Record<string, string> = {
    CATEGORY_CYCLE: 'cycle',
    CATEGORY_IN_USE: 'inUse',
    CATEGORY_SCOPE_INCOMPLETE: 'scope',
    CATEGORY_POSITION_INVALID: 'invalidPosition',
    CATEGORY_VERSION_CONFLICT: 'versionConflict',
    VERSION_CONFLICT: 'versionConflict',
    CATEGORY_IMPORT_INVALID: 'importInvalid',
    CATEGORY_COMMENT_UNAVAILABLE: 'commentUnavailable',
    CATEGORY_COMMENT_NOT_AUTHOR: 'notAuthor',
    CATEGORY_EXPORT_PARENT_UNAVAILABLE: 'exportParent',
  };
  const key =
    error instanceof ApiClientError ? reasons[error.reason ?? ''] : undefined;
  if (!key) return <MaterialError error={error} retry={retry} />;
  return (
    <Alert variant='destructive'>
      <AlertDescription>
        {t(`categoryManagement.${key}`)}
        {retry && (
          <Button type='button' variant='outline' onClick={retry}>
            {t('categoryManagement.reload')}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
