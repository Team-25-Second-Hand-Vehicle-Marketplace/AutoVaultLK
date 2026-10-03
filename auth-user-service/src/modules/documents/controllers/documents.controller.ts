import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentUploadService } from '../services/document-upload.service';

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
