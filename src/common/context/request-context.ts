import { AsyncLocalStorage } from 'async_hooks';
import { Role } from '@prisma/client';

export interface RequestContextStore {
  firmId: number;
  userId: number;
  role: Role;
}

/**
 * Per-request tenant/actor context, mirrored on Konnectify Orchestrator's
 * libs/context ContextService. Populated by TenantContextInterceptor right
 * after JwtAuthGuard verifies the token, then read by the Prisma tenant
 * extension on every query — so scoping happens at the ORM layer, not by
 * convention in each controller.
 */
export class RequestContext {
  private static readonly storage =
    new AsyncLocalStorage<RequestContextStore>();

  static run<T>(store: RequestContextStore, callback: () => T): T {
    return this.storage.run(store, callback);
  }

  static get(): RequestContextStore | undefined {
    return this.storage.getStore();
  }

  static getFirmId(): number {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error('RequestContext accessed outside of a request scope');
    }
    return store.firmId;
  }

  static getUserId(): number {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error('RequestContext accessed outside of a request scope');
    }
    return store.userId;
  }

  static getRole(): Role {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error('RequestContext accessed outside of a request scope');
    }
    return store.role;
  }
}
