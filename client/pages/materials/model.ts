import type { MaterialCategory } from '../../../shared/material-master-data.js';

export interface MaterialPageContext {
  reload: () => void;
  categorySelectionParam?: 'categoryId' | 'selected';
  selectCategory: (id: string) => void;
}

/** Visible descendants with their ancestors; filtered or inaccessible parents never hide a readable category. */
export function categoryTree(
  categories: readonly MaterialCategory[],
  search: string,
) {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const visible = new Set<string>();
  for (const category of categories) {
    if (
      !`${category.code} ${category.name}`
        .toLocaleLowerCase()
        .includes(search.trim().toLocaleLowerCase())
    )
      continue;
    let node: MaterialCategory | undefined = category;
    const seen = new Set<string>();
    while (node && !seen.has(node.id)) {
      visible.add(node.id);
      seen.add(node.id);
      node = node.parentId ? byId.get(node.parentId) : undefined;
    }
  }
  const children = new Map<string | null, MaterialCategory[]>();
  for (const category of categories) {
    if (!visible.has(category.id)) continue;
    const parent =
      category.parentId && byId.has(category.parentId)
        ? category.parentId
        : null;
    const group = children.get(parent) ?? [];
    group.push(category);
    children.set(parent, group);
  }
  return children;
}
