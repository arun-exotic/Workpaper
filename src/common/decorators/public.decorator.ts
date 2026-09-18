import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring a JWT. Only used by POST /auth/login. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
