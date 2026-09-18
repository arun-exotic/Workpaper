import { AuthenticatedUser } from './authenticated-user';

// @types/passport declares `Express.User` as an empty interface precisely so
// consumers extend it — that's what makes req.user (typed as Express.User)
// carry our shape instead of `any`. Passport's AuthGuard sets it to whatever
// JwtStrategy.validate() returns.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends AuthenticatedUser {}
  }
}
