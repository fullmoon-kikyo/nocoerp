import { randomUUID } from 'node:crypto';
import type { DatabaseConnection } from '@nocobase/db';
import type { CategoryEvent } from '../../shared/material-categories.js';

export const categoryEvents = 'md_material_category_events';
export interface CategoryActor {
  id: string;
  name: string;
}

/** All structural mutations obtain the same database row lock before examining the tree. */
export async function lockCategoryTree(
  transaction: DatabaseConnection,
): Promise<void> {
  await transaction.query
    .updateTable('md_material_category_tree_lock')
    .set({ updatedAt: new Date() })
    .where('id', '=', 'tree')
    .execute();
}

export async function categoryEvent(
  transaction: DatabaseConnection,
  input: {
    categoryId: string;
    kind: CategoryEvent['kind'];
    actor: CategoryActor;
    changes?: CategoryEvent['changes'];
    body?: string;
    replyToId?: string;
  },
) {
  const now = new Date().toISOString();
  return (
    await transaction.repository(categoryEvents).createOne({
      values: {
        id: randomUUID(),
        categoryId: input.categoryId,
        kind: input.kind,
        actorId: input.actor.id,
        actorName: input.actor.name,
        changes: input.changes ?? null,
        body: input.body ?? null,
        replyToId: input.replyToId ?? null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        editedAt: null,
      },
    })
  ).record;
}
