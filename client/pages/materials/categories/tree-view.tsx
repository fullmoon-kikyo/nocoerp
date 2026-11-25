// Adapted from NocoITAM 30c98511044708616a163a98916aeeada32abf0d (Apache-2.0).
// Modifications: project primitives/i18n, touch sizes and bounded mobile indentation.
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  useMemo,
  useState,
  type DragEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { useTranslation } from '@nocobase/i18n/client';
import { cn } from 'cn';

export interface TreeNode {
  readonly id: string;
  readonly parentId?: string | null;
  readonly label: ReactNode;
  readonly sort?: number;
  /** Muted columns shown to the right of the label (type, updated time, …). */
  readonly details?: readonly {
    key: string;
    value: ReactNode;
    width?: string;
  }[];
}

export interface TreeMove {
  readonly id: string;
  /** New parent; null for the root. */
  readonly parentId: string | null;
  /** Position among the new siblings. */
  readonly index: number;
}

export interface TreeViewProps {
  readonly nodes: readonly TreeNode[];
  /** Count shown beside each node, e.g. devices at that node. */
  readonly counts?: Readonly<Record<string, number>>;
  /** Word shown before a node's count saying what it counts (设备 / 库存 / 授权). */
  readonly countLabel?: (node: TreeNode) => ReactNode;
  /** Whether the count of a node should include its descendants. */
  readonly subtreeCounts?: boolean;
  /** The count as a muted figure, not a labelled badge (a narrow column). */
  readonly plainCounts?: boolean;
  readonly onSelect?: (id: string) => void;
  readonly selectedId?: string;
  /** When set, nodes can be dragged above / below siblings or onto a parent. */
  readonly onMove?: (move: TreeMove) => void;
  /** Start with every parent collapsed (remount with a `key` to re-apply). */
  readonly defaultCollapsed?: boolean;
  /** Rendered at the end of each row, e.g. an actions menu. */
  readonly rowActions?: (id: string) => ReactNode;
  /** Without its own card, for trees grouped inside one (categories). */
  readonly bare?: boolean;
}

interface Built {
  readonly node: TreeNode;
  readonly children: Built[];
}

type DropPlace = 'before' | 'after' | 'inside';

/** A nested list built from flat parent references; every node is expandable. */
export function TreeView({
  nodes,
  counts,
  countLabel,
  subtreeCounts = true,
  plainCounts = false,
  onSelect,
  selectedId,
  onMove,
  defaultCollapsed = false,
  rowActions,
  bare = false,
}: TreeViewProps): ReactElement {
  const { t } = useTranslation();
  const roots = useMemo(() => build(nodes), [nodes]);
  const parents = useMemo(() => {
    const ids = new Set<string>();
    const walk = (items: readonly Built[]) => {
      for (const item of items) {
        if (item.children.length > 0) {
          ids.add(item.node.id);
          walk(item.children);
        }
      }
    };
    walk(roots);
    return ids;
  }, [roots]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() =>
    defaultCollapsed ? new Set(parents) : new Set(),
  );
  const [dragging, setDragging] = useState<string>();
  const [drop, setDrop] = useState<{ id: string; place: DropPlace }>();
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const total = (built: Built): number =>
    (counts?.[built.node.id] ?? 0) +
    (subtreeCounts
      ? built.children.reduce((sum, child) => sum + total(child), 0)
      : 0);

  // A node cannot land inside itself or its own subtree.
  const isWithin = (id: string, ancestor: string): boolean => {
    let current = byId.get(id)?.parentId ?? null;
    const seen = new Set<string>();
    while (current) {
      if (current === ancestor) return true;
      if (seen.has(current)) break;
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }
    return false;
  };
  const placeFor = (event: DragEvent<HTMLElement>): DropPlace => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    return ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside';
  };
  const finish = () => {
    setDragging(undefined);
    setDrop(undefined);
  };
  const dropOn = (target: Built, siblings: readonly Built[]) => {
    if (!dragging || !drop || drop.id !== target.node.id || !onMove) return;
    if (dragging === target.node.id || isWithin(target.node.id, dragging))
      return;
    if (drop.place === 'inside') {
      onMove({
        id: dragging,
        parentId: target.node.id,
        index: target.children.length,
      });
      return;
    }
    const parentId = target.node.parentId ?? null;
    const others = siblings.filter((item) => item.node.id !== dragging);
    const at = others.findIndex((item) => item.node.id === target.node.id);
    onMove({
      id: dragging,
      parentId,
      index: drop.place === 'before' ? at : at + 1,
    });
  };

  const render = (items: readonly Built[], depth: number): ReactNode =>
    items.map((item) => {
      const isCollapsed = collapsed.has(item.node.id);
      const hasChildren = item.children.length > 0;
      const mark = drop?.id === item.node.id ? drop.place : undefined;
      return (
        <li key={item.node.id}>
          <div
            // `group/tree-row`: row actions may show on hover alone.
            data-selected={selectedId === item.node.id || undefined}
            className={cn(
              'group/tree-row relative flex items-center gap-1 rounded-md py-1 pr-2 pl-1 text-sm hover:bg-muted',
              selectedId === item.node.id && 'bg-muted',
              dragging === item.node.id && 'opacity-40',
              mark === 'inside' && 'bg-primary/10 ring-1 ring-primary/40',
              mark === 'before' &&
                'before:absolute before:inset-x-2 before:top-0 before:h-0.5 before:bg-primary',
              mark === 'after' &&
                'after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-primary',
            )}
            draggable={Boolean(onMove)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', item.node.id);
              setDragging(item.node.id);
            }}
            onDragEnd={finish}
            onDragOver={(event) => {
              if (!dragging || dragging === item.node.id) return;
              if (isWithin(item.node.id, dragging)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              const place = placeFor(event);
              if (drop?.id !== item.node.id || drop.place !== place)
                setDrop({ id: item.node.id, place });
            }}
            onDragLeave={(event) => {
              if (
                drop?.id === item.node.id &&
                !event.currentTarget.contains(event.relatedTarget as Node)
              )
                setDrop(undefined);
            }}
            onDrop={(event) => {
              event.preventDefault();
              dropOn(item, items);
              finish();
            }}
          >
            {/* No handle: the whole row drags (`draggable` above). */}
            <Button
              variant='ghost'
              type='button'
              className={cn(
                'flex size-8 min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded p-0 text-muted-foreground md:size-5 md:min-h-0 md:min-w-0',
                // A leaf keeps the arrow's room, so siblings' names line up
                // whether or not they have children of their own.
                !hasChildren && 'invisible',
              )}
              aria-label={t(
                isCollapsed
                  ? 'categoryManagement.expandNode'
                  : 'categoryManagement.collapseNode',
                {
                  name:
                    typeof item.node.label === 'string' ? item.node.label : '',
                },
              )}
              aria-expanded={!isCollapsed}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(item.node.id)) next.delete(item.node.id);
                  else next.add(item.node.id);
                  return next;
                })
              }
            >
              {isCollapsed ? (
                <ChevronRight className='size-4' />
              ) : (
                <ChevronDown className='size-4' />
              )}
            </Button>
            <Button
              variant='ghost'
              type='button'
              className='flex h-8 min-h-[32px] min-w-0 flex-1 items-center justify-between gap-6 px-0 text-left font-normal md:h-6 md:min-h-0'
              aria-current={selectedId === item.node.id ? 'true' : undefined}
              onClick={() => onSelect?.(item.node.id)}
            >
              <span className='min-w-0 flex-1 truncate'>{item.node.label}</span>
              {item.node.details?.map((detail) => (
                <span
                  key={detail.key}
                  className={cn(
                    // Right-aligned so the gap to the count badge is the same
                    // whatever the text length (类型：公司 vs 资产类型：设备).
                    'hidden shrink-0 truncate text-right text-xs text-muted-foreground sm:inline',
                    detail.width ?? 'w-24',
                  )}
                >
                  {detail.value}
                </span>
              ))}
              {counts && plainCounts ? (
                <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>
                  {total(item)}
                </span>
              ) : counts ? (
                <Badge
                  variant='secondary'
                  className='w-20 shrink-0 justify-center gap-1 tabular-nums'
                >
                  {countLabel ? (
                    <span className='font-normal text-muted-foreground'>
                      {countLabel(item.node)}
                    </span>
                  ) : null}
                  {total(item)}
                </Badge>
              ) : null}
            </Button>
            {rowActions ? (
              <span className='shrink-0'>{rowActions(item.node.id)}</span>
            ) : null}
          </div>
          {hasChildren && !isCollapsed ? (
            // Children sit one step in, along a guide line that drops from
            // their parent's arrow, so what belongs to what reads at a
            // glance rather than from an indent the width of the arrow.
            <ul
              className={cn(
                'ml-3.5 border-l border-border pl-2',
                depth >= 2 &&
                  'ml-0 border-l-0 pl-0 md:ml-3.5 md:border-l md:pl-2',
              )}
            >
              {render(item.children, depth + 1)}
            </ul>
          ) : null}
        </li>
      );
    });

  return (
    <ul
      className={
        bare ? undefined : 'rounded-lg border border-border bg-card p-2'
      }
    >
      {render(roots, 0)}
    </ul>
  );
}

function build(nodes: readonly TreeNode[]): Built[] {
  const byParent = new Map<string | null, TreeNode[]>();
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    const parent =
      node.parentId && ids.has(node.parentId) ? node.parentId : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  }
  const sortNodes = (list: TreeNode[]) =>
    [...list].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const grow = (parent: string | null): Built[] =>
    sortNodes(byParent.get(parent) ?? []).map((node) => ({
      node,
      children: grow(node.id),
    }));
  return grow(null);
}
