import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { assertFound } from '../common/errors/assert-found';
import { CreateClientDto } from './dto/create-client.dto';

@Injectable()
export class ClientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateClientDto) {
    return this.prisma.db.$transaction(async (tx) => {
      // firmId is not in `dto` and could not leak another firm's id even if
      // it were: the tenant extension overwrites it from RequestContext.
      const client = await tx.client.create({
        data: { name: dto.name } as Prisma.ClientUncheckedCreateInput,
      });
      await this.audit.record(tx, {
        clientId: client.id,
        action: AuditAction.CLIENT_CREATED,
      });
      return client;
    });
  }

  findAll() {
    return this.prisma.db.client.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async findOne(id: number) {
    const client = await this.prisma.db.client.findUnique({
      where: { id },
      include: { documents: { orderBy: { createdAt: 'asc' } } },
    });
    // Same 404 whether the row doesn't exist or belongs to another firm —
    // an attacker can't distinguish "no such client" from "not yours".
    return assertFound(client, 'Client not found');
  }
}
