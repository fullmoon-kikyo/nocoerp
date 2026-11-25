import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { MaterialCategory } from '../../../../shared/material-master-data.js';

export function useCategoryPermission(action: string) {
  const result = useCan({
    resource: { type: 'composite', id: 'masterData.categories' },
    action,
  });
  return result.can && !result.isPending;
}
export function categoryPath(
  category: MaterialCategory,
  categories: readonly MaterialCategory[],
): string {
  const byId = new Map(categories.map((row) => [row.id, row]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let at: MaterialCategory | undefined = category;
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    parts.unshift(at.name);
    at = at.parentId ? byId.get(at.parentId) : undefined;
  }
  return parts.join(' / ');
}

export function downloadCategoryCsv(
  content: string | Blob,
  filename: string,
): void {
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: 'text/csv;charset=utf-8' })
      : content;
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
