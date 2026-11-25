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
  ApiError,
  apiValidator,
  apiErrorResponses,
  dataResponse,
  listResponse,
  defineApiRoutes,
  describeRoute,
  executeIdempotentMutation,
} from '@nocobase/app-server/router';
import { databaseManagerToken } from '@nocobase/db';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  categoryInputSchema,
  categorySchema,
  materialInputSchema,
  materialSchema,
} from '../../shared/material-master-data.js';
import {
  categoryCollection,
  materialCollection,
} from '../material-master-data/resources.js';
import {
  MaterialMasterDataService,
  materialError,
  rethrowMaterialConflict,
} from '../material-master-data/service.js';

type Env = AuthEnv & AuthorizationEnv;
const headerSchema = z.object({ 'idempotency-key': z.string().min(1) });
const idSchema = z.object({ id: z.string().uuid() });
const querySchema = z.object({
  q: z.string().trim().max(200).default(''),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export default defineApiRoutes((app: Application) => {
  const auth = app.container.resolve(authenticationToken);
  const authorization = app.container.resolve(authorizationToken);
  const connection = app.container.resolve(databaseManagerToken).connection();
  const service = new MaterialMasterDataService(connection, authorization);
  const router = new Hono<Env>();
  router.use(
    '*',
    auth.required(),
    authorization.middleware(),
    bodyLimit({ maxSize: 32 * 1024 }),
  );
  const describe = (
    operationId: string,
    schema: z.ZodType,
    list = false,
    created = false,
  ) =>
    describeRoute({
      tags: ['Material master data'],
      summary: operationId,
      operationId,
      responses: {
        [created ? 201 : 200]: list
          ? listResponse(schema)
          : dataResponse(schema),
        ...apiErrorResponses,
        409: {
          description: 'A code already exists or the record version changed.',
        },
      },
    });

  async function write(
    c: Context<Env>,
    key: string,
    operation: string,
    input: unknown,
    collection: string,
    action: string,
    execute: Parameters<typeof executeIdempotentMutation>[0]['execute'],
  ) {
    const session = c.get('auth');
    if (!session)
      throw new ApiError({
        status: 'UNAUTHENTICATED',
        reason: 'AUTHENTICATION_REQUIRED',
        domain: 'materials',
        message: 'Sign in required.',
      });
    const result = await executeIdempotentMutation({
      connection,
      key,
      principal: `${app.appName}:${session.user.id}`,
      operation,
      input,
      authorize: async () => {
        await service.repository(collection, c.get('authz'), action);
      },
      authorizeReplay: async (value) => {
        const id: unknown =
          value && typeof value === 'object'
            ? Reflect.get(value, 'id')
            : undefined;
        const repository = await service.repository(
          collection,
          c.get('authz'),
          action,
        );
        if (
          typeof id !== 'string' ||
          !(await repository.findOne({ filter: { id } }))
        )
          throw materialError('REPLAY_FORBIDDEN', 'PERMISSION_DENIED');
      },
      execute,
    }).catch(rethrowMaterialConflict);
    if (result.replayed) c.header('Idempotency-Replayed', 'true');
    return result.data;
  }

  router.get(
    '/categories',
    describe('listMaterialCategories', categorySchema, true),
    async (c) => c.json({ data: await service.categories(c.get('authz')) }),
  );
  router.post(
    '/categories',
    describe('createMaterialCategory', categorySchema, false, true),
    apiValidator('header', headerSchema),
    apiValidator('json', categoryInputSchema),
    async (c) => {
      const key = c.req.valid('header')['idempotency-key'];
      const input = c.req.valid('json');
      const row = await write(
        c,
        key,
        'materials/categories/create',
        input,
        categoryCollection,
        'create',
        (tx) =>
          service.createCategory(
            c.get('authz'),
            input,
            c.get('auth')!.user.id,
            key.slice(14),
            tx,
            c.get('auth')!.user.name ?? '',
          ),
      );
      return c.json({ data: row }, 201);
    },
  );
  router.get(
    '/materials',
    describe('listMaterials', materialSchema, true),
    apiValidator('query', querySchema),
    async (c) =>
      c.json(await service.list(c.get('authz'), c.req.valid('query'))),
  );
  router.get(
    '/materials/:id',
    describe('getMaterial', materialSchema),
    apiValidator('param', idSchema),
    async (c) =>
      c.json({
        data: await service.one(c.get('authz'), c.req.valid('param').id),
      }),
  );
  router.post(
    '/materials',
    describe('createMaterial', materialSchema, false, true),
    apiValidator('header', headerSchema),
    apiValidator('json', materialInputSchema),
    async (c) => {
      const key = c.req.valid('header')['idempotency-key'];
      const input = c.req.valid('json');
      const row = await write(
        c,
        key,
        'materials/create',
        input,
        materialCollection,
        'create',
        (tx) =>
          service.saveMaterial(
            c.get('authz'),
            input,
            c.get('auth')!.user.id,
            key.slice(14),
            tx,
          ),
      );
      return c.json({ data: row }, 201);
    },
  );
  router.patch(
    '/materials/:id',
    describe('updateMaterial', materialSchema),
    apiValidator('param', idSchema),
    apiValidator('header', headerSchema),
    apiValidator(
      'json',
      materialInputSchema.extend({ expectedVersion: z.number().int().min(1) }),
    ),
    async (c) => {
      const { id } = c.req.valid('param');
      const { expectedVersion, ...input } = c.req.valid('json');
      const row = await write(
        c,
        c.req.valid('header')['idempotency-key'],
        `materials/${id}/edit`,
        c.req.valid('json'),
        materialCollection,
        'edit',
        (tx) =>
          service.saveMaterial(
            c.get('authz'),
            input,
            c.get('auth')!.user.id,
            id,
            tx,
            expectedVersion,
          ),
      );
      return c.json({ data: row });
    },
  );
  return new Hono().route('/materialMaster', router);
});
