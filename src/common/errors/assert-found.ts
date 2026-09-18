import { NotFoundException } from '@nestjs/common';

/**
 * Collapses the "look up a tenant-scoped row, 404 if the Prisma tenant
 * extension filtered it out (cross-firm) or it never existed" check that
 * every service in this app repeats verbatim. Both cases resolve to the
 * same NotFoundException on purpose — see the tenant-isolation note in
 * README.md — so this is exactly the fixed shape worth naming once.
 */
export function assertFound<T>(row: T | null | undefined, message: string): T {
  if (!row) throw new NotFoundException(message);
  return row;
}
