import type { Application } from '@nocobase/app-server/application';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization/server';
import {
  apiValidator,
  apiErrorResponses,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
  executeIdempotentMutation,
} from '@nocobase/app-server/router';
import { databaseManagerToken, type DatabaseConnection } from '@nocobase/db';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { categorySchema } from '../../shared/material-master-data.js';
import {
  categoryEditSchema,
  categoryEventSchema,
  categoryMoveSchema,
  commentInputSchema,
} from '../../shared/material-categories.js';
import {
  MaterialMasterDataService,
  rethrowMaterialConflict,
} from '../material-master-data/service.js';
import { MaterialCategoryService } from '../material-master-data/category-service.js';
import { CategoryImportService } from '../material-master-data/category-import.js';
import { categoryCollection } from '../material-master-data/resources.js';

type Env = AuthEnv & AuthorizationEnv;
const idSchema = z.object({ id: z.string().uuid() });
const headers = z.object({ 'idempotency-key': z.string().min(1) });
const version = z.strictObject({ expectedVersion: z.number().int().min(1) });
const csvInput = z.strictObject({
  csv: z
    .string()
    .min(1)
    .max(512 * 1024),
});
const commentParams = idSchema.extend({
  commentId: z.string().min(1).max(100),
});
const description = (operationId: string, schema: z.ZodType, list = false) =>
  describeRoute({
    operationId,
    summary: operationId,
    tags: ['Material categories'],
    responses: {
      200: list ? listResponse(schema) : dataResponse(schema),
      ...apiErrorResponses,
      409: {
        description:
          'Version conflict, duplicate code, or category is referenced.',
      },
    },
  });

export default defineApiRoutes((app: Application) => {
  const connection = app.container.resolve(databaseManagerToken).connection();
  const auth = app.container.resolve(authenticationToken);
  const authorization = app.container.resolve(authorizationToken);
  const base = new MaterialMasterDataService(connection, authorization);
  const service = new MaterialCategoryService(base);
  const imports = new CategoryImportService(base);
  const router = new Hono<Env>();
  router.use(
    '*',
    auth.required(),
    authorization.middleware(),
    bodyLimit({ maxSize: 1024 * 1024 }),
  );
  const actor = (c: Context<Env>) => ({
    id: c.get('auth')!.user.id,
    name: c.get('auth')!.user.name ?? '',
  });

  async function mutate<T>(
    c: Context<Env>,
    key: string,
    action: string,
    operation: string,
    input: unknown,
    execute: (tx: DatabaseConnection) => Promise<T>,
    replay: (value: T) => Promise<void>,
  ) {
    const result = await executeIdempotentMutation({
      connection,
      key,
      principal: `${app.appName}:${actor(c).id}`,
      operation,
      input,
      authorize: async () => {
        await base.repository(categoryCollection, c.get('authz'), action);
      },
      authorizeReplay: replay,
      execute,
    }).catch(rethrowMaterialConflict);
    if (result.replayed) c.header('Idempotency-Replayed', 'true');
    return c.json({ data: result.data });
  }
  const visible = async (c: Context<Env>, id: string, action: string) => {
    await service.one(c.get('authz'), id, action);
  };

  router.get(
    '/export',
    describeRoute({
      operationId: 'exportMaterialCategories',
      summary: 'Export categories as safe CSV including visible ancestors',
      tags: ['Material categories'],
      responses: {
        200: {
          description: 'UTF-8 CSV',
          content: { 'text/csv': { schema: { type: 'string' } } },
        },
        ...apiErrorResponses,
      },
    }),
    apiValidator(
      'query',
      z.object({ q: z.string().trim().max(200).default('') }),
    ),
    async (c) => {
      const csv = await imports.export(c.get('authz'), c.req.valid('query').q);
      return c.body(csv, 200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="material-categories.csv"',
      });
    },
  );
  router.post(
    '/import/preview',
    description('previewMaterialCategoryImport', z.unknown()),
    apiValidator('json', csvInput),
    async (c) =>
      c.json({
        data: await imports.preview(c.get('authz'), c.req.valid('json').csv),
      }),
  );
  router.post(
    '/import',
    description('importMaterialCategories', z.array(categorySchema)),
    apiValidator('header', headers),
    apiValidator('json', csvInput),
    async (c) => {
      const key = c.req.valid('header')['idempotency-key'];
      const input = c.req.valid('json');
      return mutate(
        c,
        key,
        'import',
        'material-categories/import',
        input,
        (tx) => imports.commit(c.get('authz'), input.csv, key, actor(c), tx),
        async (rows) => {
          for (const row of rows) {
            if (typeof row.id !== 'string')
              throw new Error('Invalid imported category receipt.');
            await visible(c, row.id, 'import');
          }
        },
      );
    },
  );
  router.patch(
    '/:id',
    description('editMaterialCategory', categorySchema),
    apiValidator('param', idSchema),
    apiValidator('header', headers),
    apiValidator('json', categoryEditSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'edit',
        `material-categories/${id}/edit`,
        c.req.valid('json'),
        (tx) =>
          service.edit(c.get('authz'), id, c.req.valid('json'), actor(c), tx),
        () => visible(c, id, 'edit'),
      );
    },
  );
  router.post(
    '/:id/move',
    description('moveMaterialCategory', categorySchema),
    apiValidator('param', idSchema),
    apiValidator('header', headers),
    apiValidator('json', categoryMoveSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'move',
        `material-categories/${id}/move`,
        c.req.valid('json'),
        (tx) =>
          service.move(c.get('authz'), id, c.req.valid('json'), actor(c), tx),
        () => visible(c, id, 'move'),
      );
    },
  );
  router.delete(
    '/:id',
    description(
      'deleteMaterialCategory',
      z.object({ id: z.string(), deleted: z.boolean() }),
    ),
    apiValidator('param', idSchema),
    apiValidator('header', headers),
    apiValidator('json', version),
    async (c) => {
      const { id } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'delete',
        `material-categories/${id}/delete`,
        c.req.valid('json'),
        (tx) =>
          service.remove(
            c.get('authz'),
            id,
            c.req.valid('json').expectedVersion,
            actor(c),
            tx,
          ),
        async () => {
          /* Current action is checked above; a replay discloses only the already-known deleted id. */
        },
      );
    },
  );
  router.get(
    '/:id/history',
    description('materialCategoryHistory', categoryEventSchema, true),
    apiValidator('param', idSchema),
    apiValidator(
      'query',
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        filter: z.enum(['all', 'comments', 'changes']).default('all'),
      }),
    ),
    async (c) =>
      c.json(
        await service.history(
          c.get('authz'),
          c.req.valid('param').id,
          c.req.valid('query'),
        ),
      ),
  );
  router.post(
    '/:id/comments',
    description('commentOnMaterialCategory', categoryEventSchema),
    apiValidator('param', idSchema),
    apiValidator('header', headers),
    apiValidator('json', commentInputSchema),
    async (c) => {
      const { id } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'comment',
        `material-categories/${id}/comments`,
        c.req.valid('json'),
        (tx) =>
          service.comment(
            c.get('authz'),
            id,
            c.req.valid('json'),
            actor(c),
            tx,
          ),
        () => visible(c, id, 'comment'),
      );
    },
  );
  router.patch(
    '/:id/comments/:commentId',
    description('editMaterialCategoryComment', categoryEventSchema),
    apiValidator('param', commentParams),
    apiValidator('header', headers),
    apiValidator(
      'json',
      version.extend({ body: z.string().trim().min(1).max(2000) }),
    ),
    async (c) => {
      const { id, commentId } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'comment',
        `material-categories/${id}/comments/${commentId}/edit`,
        c.req.valid('json'),
        (tx) =>
          service.editComment(
            c.get('authz'),
            id,
            commentId,
            c.req.valid('json'),
            actor(c),
            tx,
          ),
        () => visible(c, id, 'comment'),
      );
    },
  );
  router.delete(
    '/:id/comments/:commentId',
    description('deleteMaterialCategoryComment', categoryEventSchema),
    apiValidator('param', commentParams),
    apiValidator('header', headers),
    apiValidator('json', version),
    async (c) => {
      const { id, commentId } = c.req.valid('param');
      return mutate(
        c,
        c.req.valid('header')['idempotency-key'],
        'comment',
        `material-categories/${id}/comments/${commentId}/delete`,
        c.req.valid('json'),
        (tx) =>
          service.editComment(
            c.get('authz'),
            id,
            commentId,
            c.req.valid('json'),
            actor(c),
            tx,
            true,
          ),
        () => visible(c, id, 'comment'),
      );
    },
  );
  return new Hono().route('/materialMaster/categories', router);
});
