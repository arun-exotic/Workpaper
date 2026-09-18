import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../common/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ReviewDocumentDto } from './dto/review-document.dto';
import { DocumentsService } from './documents.service';

// 10MB comfortably covers a scanned bank statement/invoice PDF (the real
// sample in sample-data/ is ~150KB) without leaving the endpoint able to
// buffer an unbounded body into memory — FileInterceptor with no limits
// imposes none.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

@ApiTags('documents')
@ApiBearerAuth()
@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly auditService: AuditService,
  ) {}

  @Post('clients/:clientId/documents')
  @Roles(Role.ADMIN)
  create(
    @Param('clientId', ParseIntPipe) clientId: number,
    @Body() dto: CreateDocumentDto,
  ) {
    return this.documentsService.create(clientId, dto);
  }

  @Get('clients/:clientId/documents')
  @Roles(Role.ADMIN, Role.STAFF, Role.REVIEWER)
  findByClient(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.documentsService.findByClient(clientId);
  }

  @Get('documents/:id')
  @Roles(Role.ADMIN, Role.STAFF, Role.REVIEWER)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.documentsService.findOne(id);
  }

  @Get('documents/:id/file')
  @Roles(Role.ADMIN, Role.STAFF, Role.REVIEWER)
  async downloadFile(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<StreamableFile> {
    const { stream, size, filename, mimeType } =
      await this.documentsService.getFile(id);
    // "inline" (not "attachment") so a PDF opens in the browser tab a
    // frontend's "view document" link points at, while still letting the
    // user save it — same endpoint covers both "view" and "download".
    return new StreamableFile(stream, {
      type: mimeType,
      length: size,
      disposition: `inline; filename="${filename}"`,
    });
  }

  @Post('documents/:id/upload')
  @Roles(Role.STAFF, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  upload(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('A file is required');
    return this.documentsService.upload(id, file);
  }

  @Post('documents/:id/start-review')
  @Roles(Role.REVIEWER)
  startReview(@Param('id', ParseIntPipe) id: number) {
    return this.documentsService.startReview(id);
  }

  @Post('documents/:id/review')
  @Roles(Role.REVIEWER)
  review(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewDocumentDto,
  ) {
    return this.documentsService.review(id, dto);
  }

  @Get('documents/:id/audit-log')
  @Roles(Role.ADMIN, Role.STAFF, Role.REVIEWER)
  auditLog(@Param('id', ParseIntPipe) id: number) {
    return this.auditService.findByDocument(id);
  }

  @Get('clients/:clientId/audit-log')
  @Roles(Role.ADMIN, Role.STAFF, Role.REVIEWER)
  clientAuditLog(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.auditService.findByClient(clientId);
  }
}
