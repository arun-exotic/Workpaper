import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService, PrismaTx } from '../prisma/prisma.service';
import { RequestContext } from '../common/context/request-context';
import { assertFound } from '../common/errors/assert-found';

interface RecordAuditEventParams {
  clientId: number;
  documentId?: number;
  action: AuditAction;
  comment?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Writes one audit row. Callers pass the same transaction client (`tx`)
   * they used for the state change this event describes, so the two commit
   * or roll back together — an approval can never exist without the event
   * that says who approved it and when.
   *
   * There is deliberately no update()/delete() here and no PATCH/DELETE
   * route anywhere in AuditController: once written, an event is
   * unreachable by every role, including ADMIN.
   */
  async record(tx: PrismaTx, params: RecordAuditEventParams) {
    await tx.auditEvent.create({
      // firmId is required by the generated type but intentionally absent
      // here: the tenant extension (src/prisma/tenant.extension.ts) injects
      // it from RequestContext at runtime. Same pattern Orchestrator uses
      // for every tenant-scoped create.
      data: {
        clientId: params.clientId,
        documentId: params.documentId,
        action: params.action,
        comment: params.comment,
        actorId: RequestContext.getUserId(),
      } as Prisma.AuditEventUncheckedCreateInput,
    });
  }

  /**
   * Every event in the caller's firm, newest first — a firm-wide activity
   * feed. No explicit firmId filter needed: the tenant extension scopes
   * this findMany() the same way it scopes every other query.
   */
  async findAll() {
    return this.prisma.db.auditEvent.findMany({
      include: {
        actor: { select: { id: true, name: true, role: true } },
        client: { select: { id: true, name: true } },
        document: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByClient(clientId: number) {
    await this.assertClientInFirm(clientId);
    return this.prisma.db.auditEvent.findMany({
      where: { clientId },
      include: {
        actor: { select: { id: true, name: true, role: true } },
        document: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByDocument(documentId: number) {
    await this.assertDocumentInFirm(documentId);
    return this.prisma.db.auditEvent.findMany({
      where: { documentId },
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async assertClientInFirm(clientId: number) {
    // Scoped automatically by the tenant extension: a client belonging to
    // another firm resolves to null here, so this 404s exactly like a
    // client that never existed — no distinct "forbidden" signal leaks
    // whether the row exists elsewhere.
    const client = await this.prisma.db.client.findUnique({
      where: { id: clientId },
    });
    assertFound(client, 'Client not found');
  }

  private async assertDocumentInFirm(documentId: number) {
    const document = await this.prisma.db.document.findUnique({
      where: { id: documentId },
    });
    assertFound(document, 'Document not found');
  }
}
