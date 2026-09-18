import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

export interface JwtPayload {
  sub: number;
  firmId: number;
  role: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.getOrThrow<string>('JWT_SECRET'),
    });
  }

  /**
   * Re-reads the user from the database rather than trusting the token's
   * embedded role/firmId verbatim, so a role change or deactivation takes
   * effect immediately instead of only after the token expires. Runs before
   * TenantContextInterceptor sets the ALS context, so this lookup is
   * intentionally unscoped (find-by-id, already globally unique).
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user || user.firmId !== payload.firmId) {
      throw new UnauthorizedException('Invalid session');
    }
    return {
      id: user.id,
      firmId: user.firmId,
      role: user.role,
      email: user.email,
      name: user.name,
    };
  }
}
