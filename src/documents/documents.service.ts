import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditAction, DocumentStatus, Prisma } from '@prisma/client';
import * as path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { FileStorageService } from '../storage/file-storage.service';
import { RequestContext } from '../common/context/request-context';
import { assertFound } from '../common/errors/assert-found';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ReviewAction, ReviewDocumentDto } from './dto/review-document.dto';

// Small, fixed set of extensions this app's documents actually use — a full
// mime-type library would be overkill for a prototype that only ever stores
// scanned financial documents.
const MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function mimeTypeFor(filename: string | null): string {
  if (!filename) return 'application/octet-stream';
  return (
    MIME_TYPES[path.extname(filename).toLowerCase()] ??
    'application/octet-stream'
  );
}

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: FileStorageService,
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

  async findByClient(clientId: number) {
    // Without this, a cross-firm or nonexistent clientId silently returns
    // [] instead of 404 — the only read in this service that skipped the
    // existence check every other one makes.
    await this.getClientOrThrow(clientId);
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
    return assertFound(document, 'Document not found');
  }

  /** The actual uploaded file, for a real download/view instead of just its metadata. */
  async getFile(id: number) {
    const document = await this.getDocumentOrThrow(id);
    if (!document.filePath) {
      throw new NotFoundException(
        'No file has been uploaded for this document yet',
      );
    }

    const buffer = await this.storage.read(document.filePath);
    return {
      buffer,
      size: buffer.length,
      filename: document.fileOriginalName ?? `document-${id}`,
      mimeType: mimeTypeFor(document.fileOriginalName),
    };
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
    // path.basename strips any directory component the caller's filename
    // might contain. Busboy already does this before file.originalname
    // reaches us (see its default preservePath: false), so this is
    // deliberately redundant — it shouldn't depend on that upstream
    // default holding forever, since this is the one place a filename
    // controlled by an authenticated-but-untrusted upload ends up in a
    // storage key (a filesystem path for the local driver, an object key
    // for Supabase Storage — see src/storage/).
    const safeOriginalName = path.basename(file.originalname);
    const storedName = `${id}-${Date.now()}-${safeOriginalName}`;
    const storageKey = `${firmId}/${document.clientId}/${storedName}`;

    await this.storage.save(storageKey, file.buffer);

    return this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.document.update({
        where: { id },
        data: {
          status: DocumentStatus.UPLOADED,
          filePath: storageKey,
          fileOriginalName: safeOriginalName,
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
          ? `Uploaded revised document (${safeOriginalName})`
          : `Uploaded ${safeOriginalName}`,
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
    return assertFound(client, 'Client not found');
  }

  private async getDocumentOrThrow(id: number) {
    const document = await this.prisma.db.document.findUnique({
      where: { id },
    });
    return assertFound(document, 'Document not found');
  }
}
