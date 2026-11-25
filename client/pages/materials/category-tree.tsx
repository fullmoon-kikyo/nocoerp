import { useState, type ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Folder, Plus } from 'lucide-react';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#components/ui/collapsible';
import { useIsMobile } from '#hooks/use-mobile';
import type { MaterialCategory } from '../../../shared/material-master-data.js';
import { categoryTree } from './model.js';

export function CategoryTree({
  categories,
  selected,
  searchString,
  canCreate,
  onSelect,
}: {
  categories: readonly MaterialCategory[];
  selected: string;
  searchString: string;
  canCreate: boolean;
  onSelect: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const [open, setOpen] = useState<boolean>();
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const children = categoryTree(categories, search);
  const branch = (parent: string | null): ReactElement => (
    <ul className={parent ? 'ml-3 grid gap-1 border-l pl-2' : 'grid gap-1'}>
      {(children.get(parent) ?? []).map((category) => {
        const hasChildren = Boolean(children.get(category.id)?.length);
        const expanded = Boolean(search) || !collapsed.has(category.id);
        return (
          <li key={category.id} className='min-w-0'>
            <div className='flex min-w-0 items-center gap-1'>
              {hasChildren ? (
                <Button
                  type='button'
                  size='icon-sm'
                  variant='ghost'
                  aria-label={t(
                    expanded ? 'materials.collapse' : 'materials.expand',
                    { name: category.name },
                  )}
                  aria-expanded={expanded}
                  onClick={() =>
                    setCollapsed((old) => {
                      const next = new Set(old);
                      if (next.has(category.id)) next.delete(category.id);
                      else next.add(category.id);
                      return next;
                    })
                  }
                >
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              ) : (
                <Folder className='mx-2 size-4 shrink-0 text-muted-foreground' />
              )}
              <Button
                type='button'
                variant={selected === category.id ? 'secondary' : 'ghost'}
                className='min-w-0 flex-1 justify-start'
                aria-current={selected === category.id ? 'true' : undefined}
                onClick={() => onSelect(category.id)}
                title={`${category.code} · ${category.name}`}
              >
                <span className='truncate'>{category.name}</span>
              </Button>
            </div>
            {hasChildren && expanded && branch(category.id)}
          </li>
        );
      })}
    </ul>
  );
  return (
    <Collapsible
      open={open ?? !mobile}
      onOpenChange={setOpen}
      className='min-w-0 rounded-lg border bg-card p-3 md:self-start'
    >
      <div className='flex items-center justify-between gap-2'>
        <CollapsibleTrigger
          render={
            <Button variant='ghost' className='min-w-0 justify-start px-1' />
          }
        >
          <Folder />
          {t('materials.categories')}
          <ChevronDown />
        </CollapsibleTrigger>
        {canCreate && (
          <Button
            nativeButton={false}
            variant='ghost'
            size='icon-sm'
            aria-label={t('materials.newCategory')}
            render={
              <Link
                to={{ pathname: 'categories/create', search: searchString }}
              />
            }
          >
            <Plus />
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className='grid min-w-0 gap-3 pt-3'>
          <Input
            value={search}
            aria-label={t('materials.categorySearch')}
            placeholder={t('materials.categorySearch')}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            variant={!selected ? 'secondary' : 'ghost'}
            className='justify-start'
            aria-current={!selected ? 'true' : undefined}
            onClick={() => onSelect('')}
          >
            {t('materials.allCategories')}
          </Button>
          <nav
            aria-label={t('materials.categories')}
            className='max-h-[min(32rem,60dvh)] overflow-y-auto'
          >
            {branch(null)}
          </nav>
          {!categories.length && (
            <p className='text-sm text-muted-foreground'>
              {t('materials.emptyCategories')}
            </p>
          )}
          {categories.length > 0 && !children.size && (
            <p className='text-sm text-muted-foreground'>
              {t('materials.noMatches')}
            </p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
