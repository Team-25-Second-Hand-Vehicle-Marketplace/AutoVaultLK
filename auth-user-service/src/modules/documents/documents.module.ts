import { Module } from '@nestjs/common';
import { DocumentsController } from './controllers/documents.controller';
import { LocalDocumentsController } from './controllers/local-documents.controller';
import { DocumentUploadService } from './services/document-upload.service';
import { DocumentUrlResolverService } from './services/document-url-resolver.service';

/**
 * Verification-document upload (FR-02.1) — DocumentUploadService lets the
 * dealer registration wizard attach a business registration certificate
 * before the account exists; DocumentUrlResolverService turns the stored
 * key back into something an admin can view. Exported so DealerProfilesModule
 * (or wherever admin-facing dealer detail is resolved) can reuse the resolver.
 */
@Module({
  controllers: [DocumentsController, LocalDocumentsController],
  providers: [DocumentUploadService, DocumentUrlResolverService],
  exports: [DocumentUploadService, DocumentUrlResolverService],
})
export class DocumentsModule {}
