import { z } from 'zod';

const code = z.string().trim().min(1).max(64).regex(/^\S+$/);
export const categoryInputSchema = z.strictObject({
  code,
  name: z.string().trim().min(1).max(100),
  parentId: z.string().uuid().nullable(),
  description: z.string().trim().max(2000).default(''),
});
export const materialInputSchema = z.strictObject({
  code,
  name: z.string().trim().min(1).max(200),
  categoryId: z.string().uuid(),
  specification: z.string().trim().max(300),
  drawingNumber: z.string().trim().max(100),
  unit: z.string().trim().min(1).max(32),
  materialGrade: z.string().trim().max(100),
  remarks: z.string().trim().max(2000),
  enabled: z.boolean(),
});
const audit = {
  id: z.string().uuid(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdById: z.string(),
  updatedById: z.string(),
};
export const categorySchema = categoryInputSchema.extend({
  ...audit,
  sortOrder: z.number().int(),
});
export const materialSchema = materialInputSchema.extend(audit);
export type MaterialCategory = z.infer<typeof categorySchema>;
export type Material = z.infer<typeof materialSchema>;
export type CategoryInput = z.infer<typeof categoryInputSchema>;
export type MaterialInput = z.infer<typeof materialInputSchema>;

export const blankMaterial: MaterialInput = {
  code: '',
  name: '',
  categoryId: '',
  specification: '',
  drawingNumber: '',
  unit: '',
  materialGrade: '',
  remarks: '',
  enabled: true,
};
