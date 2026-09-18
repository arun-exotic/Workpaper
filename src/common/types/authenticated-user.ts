import { Role } from '@prisma/client';

export interface AuthenticatedUser {
  id: number;
  firmId: number;
  role: Role;
  email: string;
  name: string;
}
