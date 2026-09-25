import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentUploadService } from '../services/document-upload.service';

/**
 * Verification-document upload for dealer registration (FR-02.1). Public
 * (no JwtAuthGuard): this runs before the account exists, so there is no
 * session to authenticate yet — the same reason ImageUploadService's
 * equivalent in marketplace-service can require a JWT but this one cannot.
 * Multer's memory storage, matching marketplace-service's listing image
 * upload: DocumentUploadService decides where the bytes land.
 */
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentUploadService: DocumentUploadService) {}

  @Post('verification')
  @UseInterceptors(FileInterceptor('document'))
  async uploadVerificationDocument(
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('A document file is required');
    }
    return this.documentUploadService.uploadPending(file);
  }
}
