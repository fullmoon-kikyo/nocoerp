import { z } from 'zod';
import { categoryInputSchema } from './material-master-data.js';

export const categoryEditSchema = categoryInputSchema
  .omit({ parentId: true })
  .extend({ expectedVersion: z.number().int().min(1) });
export const categoryMoveSchema = z.strictObject({
  parentId: z.string().uuid().nullable(),
  index: z.number().int().min(0),
  expectedVersion: z.number().int().min(1),
});
export const commentInputSchema = z.strictObject({
  body: z.string().trim().min(1).max(2000),
  replyToId: z.string().min(1).max(100).optional(),
});
export const categoryEventSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  kind: z.enum([
    'initial',
    'created',
    'updated',
    'moved',
    'deleted',
    'comment',
  ]),
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  body: z.string().nullable(),
  changes: z
    .record(z.string(), z.object({ before: z.unknown(), after: z.unknown() }))
    .nullable(),
  replyToId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
  editedAt: z.string().nullable(),
  version: z.number().int(),
});
export type CategoryEvent = z.infer<typeof categoryEventSchema>;
export interface CategoryImportRow {
  line: number;
  code: string;
  name: string;
  parentCode: string;
  description: string;
}
export interface CategoryImportIssue {
  line: number;
  field: string;
  reason: string;
}
export interface CategoryImportPreview {
  rows: CategoryImportRow[];
  errors: CategoryImportIssue[];
  total: number;
}
