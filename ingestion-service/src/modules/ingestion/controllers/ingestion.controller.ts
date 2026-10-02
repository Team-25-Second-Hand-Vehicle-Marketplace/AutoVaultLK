import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';

import {
  FileFieldsInterceptor,
} from '@nestjs/platform-express';

import {
  JwtAuthGuard,
} from '../../auth/guards/jwt-auth.guard';

import {
  RolesGuard,
} from '../../auth/guards/roles.guard';

import {
  Roles,
} from '../../auth/decorators/roles.decorator';

import {
  CurrentUser,
} from '../../auth/decorators/current-user.decorator';

import type {
  AuthenticatedUser,
} from '../../auth/types/authenticated-user.type';

import {
  IngestionUploadService,
} from '../services/ingestion-upload.service';

@Controller('ingest')
export class IngestionController {
  constructor(
    private readonly uploadService: IngestionUploadService,
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

    return this.uploadService.upload(
      user.id,
      file,
      format,
      zip,
    );
  }
}
