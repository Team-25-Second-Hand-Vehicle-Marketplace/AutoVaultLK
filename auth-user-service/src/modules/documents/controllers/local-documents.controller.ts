import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { documentServeConfig } from '../../../config/document-serve.config';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { safeLocalPath } from '../safe-local-path';

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

/**
 * Streams a verification document from local storage. DOCUMENT_SERVE_MODE=local
 * dev convenience only — mirrors marketplace-service's LocalImagesController,
 * but ADMIN-only: unlike vehicle photos, a NIC scan or business registration
 * certificate is sensitive KYC data that must never be reachable without
 * authentication, even in a route that only exists for local dev.
 */
@Controller('documents/local')
export class LocalDocumentsController {
  private readonly logger = new Logger(LocalDocumentsController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('*key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async stream(@Param('key') keySegments: string[]): Promise<StreamableFile> {
    const key = keySegments.join('/');
    const cfg = documentServeConfig(this.config);

    if (cfg.mode !== 'local') {
      throw new NotFoundException(
        `This route only serves documents when DOCUMENT_SERVE_MODE=local (current mode: ${cfg.mode})`,
      );
    }

    const path = this.resolvePath(cfg.root, key);
    await this.assertExists(path, key);

    return new StreamableFile(createReadStream(path), {
      type:
        CONTENT_TYPES[extname(path).toLowerCase()] ??
        'application/octet-stream',
    });
  }

  private resolvePath(root: string, key: string): string {
    try {
      return safeLocalPath(root, key);
    } catch (err) {
      this.logger.warn(
        `Rejected document key: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException('Document not found');
    }
  }

  private async assertExists(path: string, key: string): Promise<void> {
    try {
      await stat(path);
    } catch {
      this.logger.debug(`Document key not found on disk: ${key}`);
      throw new NotFoundException('Document not found');
    }
  }
}
