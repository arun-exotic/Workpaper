import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Declares which roles (within the caller's own firm) may hit this route. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
