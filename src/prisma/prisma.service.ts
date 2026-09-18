import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { tenantScopeExtension } from './tenant.extension';

const extendedPrisma = () => new PrismaClient().$extends(tenantScopeExtension);

export type ExtendedPrismaClient = ReturnType<typeof extendedPrisma>;
export type PrismaTx = Parameters<
  Parameters<ExtendedPrismaClient['$transaction']>[0]
>[0];

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly db: ExtendedPrismaClient = extendedPrisma();

  async onModuleInit() {
    await this.db.$connect();
  }

  async onModuleDestroy() {
    await this.db.$disconnect();
  }
}
