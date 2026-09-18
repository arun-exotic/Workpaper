import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, DocumentStatus, Prisma } from '@prisma/client';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RequestContext } from '../common/context/request-context';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ReviewAction, ReviewDocumentDto } from './dto/review-document.dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async create(clientId: number, dto: CreateDocumentDto) {
    await this.getClientOrThrow(clientId);
    return this.prisma.db.$transaction(async (tx) => {
      const document = await tx.document.create({
        // firmId injected by the tenant extension at runtime — see the note
        // on the same pattern in AuditService.record().
        data: {
          clientId,
          name: dto.name,
          status: DocumentStatus.PENDING,
        } as Prisma.DocumentUncheckedCreateInput,
      });
      await this.audit.record(tx, {
        clientId,
        documentId: document.id,
        action: AuditAction.DOCUMENT_REQUESTED,
        comment: `Requested "${dto.name}"`,
      });
      return document;
    });
  }

  findByClient(clientId: number) {
    return this.prisma.db.document.findMany({
      where: { clientId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: number) {
    const document = await this.prisma.db.document.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  /** Staff uploads (or re-uploads after a correction request). */
  async upload(id: number, file: { originalname: string; buffer: Buffer }) {
    const document = await this.getDocumentOrThrow(id);

    if (document.status === DocumentStatus.APPROVED) {
      throw new BadRequestException(
        'Document is already approved and cannot be re-uploaded',
      );
    }
    if (document.status === DocumentStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        'Document is currently under review and cannot be re-uploaded',
      );
    }

    const wasCorrectionRequested =
      document.status === DocumentStatus.CORRECTION_REQUIRED;
    const firmId = RequestContext.getFirmId();
    const storedName = `${id}-${Date.now()}-${file.originalname}`;
    const relativePath = path.join(
      String(firmId),
      String(document.clientId),
      storedName,
    );
    const uploadRoot = this.config.get<string>('UPLOAD_DIR', 'uploads');

    await fs.mkdir(path.dirname(path.join(uploadRoot, relativePath)), {
      recursive: true,
    });
    await fs.writeFile(path.join(uploadRoot, relativePath), file.buffer);

    return this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: {
          status: DocumentStatus.UPLOADED,
          filePath: relativePath,
          fileOriginalName: file.originalname,
          uploadedById: RequestContext.getUserId(),
          uploadedAt: new Date(),
          reviewComment: null,
        },
      });
      await this.audit.record(tx, {
        clientId: document.clientId,
        documentId: id,
        action: AuditAction.DOCUMENT_UPLOADED,
        comment: wasCorrectionRequested
          ? `Uploaded revised document (${file.originalname})`
          : `Uploaded ${file.originalname}`,
      });
      return updated;
    });
  }

  /** Reviewer opens the document for review, matching the audit example's granularity. */
  async startReview(id: number) {
    const document = await this.getDocumentOrThrow(id);
    if (document.status !== DocumentStatus.UPLOADED) {
      throw new BadRequestException(
        `Cannot start review from status ${document.status}`,
      );
    }

    return this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: { status: DocumentStatus.UNDER_REVIEW },
      });
      await this.audit.record(tx, {
        clientId: document.clientId,
        documentId: id,
        action: AuditAction.REVIEW_STARTED,
      });
      return updated;
    });
  }

  /** Reviewer's decision: approve, or request a correction with a comment. */
  async review(id: number, dto: ReviewDocumentDto) {
    const document = await this.getDocumentOrThrow(id);
    if (document.status !== DocumentStatus.UNDER_REVIEW) {
      throw new BadRequestException(
        `Document must be under review before it can be ${dto.action === ReviewAction.APPROVE ? 'approved' : 'sent back for correction'} (currently ${document.status})`,
      );
    }

    const isApproval = dto.action === ReviewAction.APPROVE;

    return this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: {
          status: isApproval
            ? DocumentStatus.APPROVED
            : DocumentStatus.CORRECTION_REQUIRED,
          reviewComment: isApproval ? null : dto.comment,
        },
      });
      await this.audit.record(tx, {
        clientId: document.clientId,
        documentId: id,
        action: isApproval
          ? AuditAction.DOCUMENT_APPROVED
          : AuditAction.CORRECTION_REQUESTED,
        comment: isApproval ? undefined : dto.comment,
      });
      return updated;
    });
  }

  private async getClientOrThrow(clientId: number) {
    const client = await this.prisma.db.client.findUnique({
      where: { id: clientId },
    });
    if (!client) throw new NotFoundException('Client not found');
    return client;
  }

  private async getDocumentOrThrow(id: number) {
    const document = await this.prisma.db.document.findUnique({
      where: { id },
    });
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }
}
