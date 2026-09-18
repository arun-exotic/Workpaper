import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
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

  @Post('documents/:id/upload')
  @Roles(Role.STAFF, Role.ADMIN)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
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
