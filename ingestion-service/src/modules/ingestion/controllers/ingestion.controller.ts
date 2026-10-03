import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';

import { FileFieldsInterceptor } from '@nestjs/platform-express';

import type { Request } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

import { RolesGuard } from '../../auth/guards/roles.guard';

import { Roles } from '../../auth/decorators/roles.decorator';

import { CurrentUser } from '../../auth/decorators/current-user.decorator';

import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';

import { IngestionUploadService } from '../services/ingestion-upload.service';

import { PresignUploadDto } from '../dto/presign-upload.dto';
import {
  OBJECT_STORE,
  type ObjectStore,
} from '../../../infrastructure/ports/object-store.port';

/**
 * A pathological or malicious local-dev PUT must not buffer an unbounded
 * body into memory. 300 MB matches nginx's own ceiling for this route
 * locally (25 MB CSV + 250 MB ZIP + multipart overhead - see
 * api-gateway/local/nginx.conf) even though this path carries one file, not
 * a multipart envelope.
 */
const MAX_LOCAL_UPLOAD_BYTES = 300 * 1024 * 1024;

@Controller('ingest')
export class IngestionController {
  constructor(
    private readonly uploadService: IngestionUploadService,

    @Inject(OBJECT_STORE)
    private readonly objectStore: ObjectStore,
  ) {}

  @Post('upload')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  @UseInterceptors(
    FileFieldsInterceptor([
      {
        name: 'file',
        maxCount: 1,
      },
      {
        name: 'zip',
        maxCount: 1,
      },
    ]),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,

    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      zip?: Express.Multer.File[];
    },

    @Body('format') format?: string,
  ) {
    const file = files?.file?.[0];
    const zip = files?.zip?.[0];

    if (!file) {
      throw new BadRequestException(
        'Inventory file is required (multipart field `file`)',
      );
    }

    return this.uploadService.upload(user.id, file, format, zip);
  }

  /**
   * Step 1 of the direct-to-S3 flow (see IngestionUploadService.presignUpload):
   * returns a jobId plus a presigned PUT per file. Nothing is uploaded here -
   * the dealer's browser PUTs straight to storage next, then calls
   * POST /ingest/upload/:jobId/complete.
   */
  @Post('presign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  async presign(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PresignUploadDto,
  ) {
    return this.uploadService.presignUpload(
      user.id,
      { fileName: dto.csvFileName, fileSize: dto.csvFileSize },
      dto.format,
      dto.zipFileName && dto.zipFileSize
        ? { fileName: dto.zipFileName, fileSize: dto.zipFileSize }
        : undefined,
    );
  }

  /** Step 2: confirms the direct-to-S3 upload(s) landed, then starts the pipeline. */
  @Post('upload/:jobId/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('DEALER')
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ) {
    return this.uploadService.completeUpload(user.id, jobId);
  }

  /**
   * Local-dev-only counterpart to a real S3 presigned PUT (see
   * LocalObjectStore.getUploadTarget) - exists purely so the frontend can use
   * one upload flow in both environments instead of branching on which
   * storage driver is running. In 's3' mode the dealer's browser never calls
   * this; it PUTs straight to S3.
   *
   * Deliberately unguarded by auth, matching a real presigned URL's own
   * security model: knowing the exact (unguessable, server-issued) URL is
   * the authorization, not a bearer token - S3's CORS does not support
   * credentialed requests either, so the frontend cannot attach one here
   * even for the real driver. The `raw/` prefix check is what presignUpload
   * ever hands out, so it is the only thing this endpoint will ever write to.
   */
  @Put('local-object/:encodedKey')
  async putLocalObject(
    @Param('encodedKey') encodedKey: string,
    @Req() req: Request,
  ) {
    const key = decodeURIComponent(encodedKey);
    if (!key.startsWith('raw/')) {
      throw new BadRequestException('Invalid upload target');
    }

    const rawContentType = req.headers['content-type'];
    const contentType =
      typeof rawContentType === 'string' ? rawContentType : undefined;

    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of req as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > MAX_LOCAL_UPLOAD_BYTES) {
        throw new BadRequestException('File exceeds the maximum allowed size');
      }
      chunks.push(chunk);
    }

    await this.objectStore.put(key, Buffer.concat(chunks), contentType);
    return { success: true };
  }
}
