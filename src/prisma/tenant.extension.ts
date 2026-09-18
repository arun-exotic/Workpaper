import { Prisma } from '@prisma/client';
import { RequestContext } from '../common/context/request-context';

/**
 * Every model that belongs to a Firm. Scaled-down version of Konnectify
 * Orchestrator's libs/database prisma-multitenant.extension.ts: that one
 * derives scoped columns from the Prisma DMMF because it spans dozens of
 * models across org/tenant/project/workspace levels. This app has one scope
 * level (firm) and four models, so a plain list is more readable than
 * reproducing the DMMF-scanning machinery.
 */
const FIRM_SCOPED_MODELS = new Set([
  'User',
  'Client',
  'Document',
  'AuditEvent',
]);

interface ScopableArgs {
  data?: Record<string, unknown> | Record<string, unknown>[];
  where?: Record<string, unknown>;
}

/**
 * Prisma Client extension that makes cross-firm access a structural
 * impossibility rather than a per-controller convention:
 *  - every read/update/delete on a firm-scoped model is filtered by the
 *    current request's firmId, taken from AsyncLocalStorage (RequestContext)
 *  - every create on a firm-scoped model has its firmId forced to the
 *    current request's firmId, overriding whatever (if anything) the caller
 *    supplied — a request body can never plant a different firm's id.
 *
 * When no RequestContext is set (e.g. the pre-auth login lookup by email, or
 * a seed script using its own unextended PrismaClient) the extension is a
 * no-op passthrough — there is no tenant to scope to yet.
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenantScope',
  query: {
    $allOperations({ model, operation, args, query }) {
      if (!model || !FIRM_SCOPED_MODELS.has(model)) {
        return query(args);
      }

      const ctx = RequestContext.get();
      if (!ctx) {
        return query(args);
      }

      const scopable = args as ScopableArgs;

      const isCreate =
        operation === 'create' ||
        operation === 'createMany' ||
        operation === 'createManyAndReturn';
      const isRead =
        operation.startsWith('find') ||
        operation === 'aggregate' ||
        operation === 'count' ||
        operation === 'groupBy';
      const isUpdate = operation === 'update' || operation === 'updateMany';
      const isDelete = operation === 'delete' || operation === 'deleteMany';

      if (isCreate && scopable.data) {
        scopable.data = Array.isArray(scopable.data)
          ? scopable.data.map((row) => ({ ...row, firmId: ctx.firmId }))
          : { ...scopable.data, firmId: ctx.firmId };
      }

      if (isRead || isUpdate || isDelete) {
        scopable.where = { ...scopable.where, firmId: ctx.firmId };
      }

      return query(scopable as typeof args);
    },
  },
});
