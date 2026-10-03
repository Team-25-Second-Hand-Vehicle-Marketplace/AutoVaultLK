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
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { imageServeConfig } from '../../../config/image-serve.config';
import { safeLocalPath } from '../safe-local-path';

const CONTENT_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

@Controller('images/local')
export class LocalImagesController {
  private readonly logger = new Logger(LocalImagesController.name);

  constructor(private readonly config: ConfigService) {}

  @Get('*key')
  async stream(@Param('key') keySegments: string[]): Promise<StreamableFile> {
    const key = keySegments.join('/');
    const cfg = imageServeConfig(this.config);

    if (cfg.mode !== 'local') {
      // Not a 404-because-missing-file: the route exists, but this
      // deployment isn't configured to serve through it. A distinct message
      // is worth more than an identical-looking 404 when someone is
      // debugging why images aren't loading in an s3/demo environment.
      throw new NotFoundException(
        `This route only serves images when IMAGE_SERVE_MODE=local (current mode: ${cfg.mode})`,
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
      // A traversal attempt and a malformed key both fail the same way from
      // the caller's point of view: a 404, not a stack trace revealing the
      // storage root's filesystem layout.
      this.logger.warn(
        `Rejected image key: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new NotFoundException('Image not found');
    }
  }

  private async assertExists(path: string, key: string): Promise<void> {
    try {
      await stat(path);
    } catch {
      this.logger.debug(`Image key not found on disk: ${key}`);
      throw new NotFoundException('Image not found');
    }
  }
}
