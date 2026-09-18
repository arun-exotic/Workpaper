import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Request } from 'express';
import { Observable } from 'rxjs';
import { RequestContext } from '../context/request-context';

/**
 * Runs after JwtAuthGuard (interceptors execute after guards in Nest's
 * pipeline), so request.user is set for every non-@Public route. Wraps the
 * rest of the request — the controller method and everything it calls,
 * including every Prisma query — in the AsyncLocalStorage context that
 * PrismaTenantExtension reads. @Public routes have no request.user and pass
 * through unscoped (e.g. login, which must look up a user by email before
 * any firm is known).
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      RequestContext.run(
        { firmId: user.firmId, userId: user.id, role: user.role },
        () => {
          next.handle().subscribe(subscriber);
        },
      );
    });
  }
}
