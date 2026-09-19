import unzipper from 'unzipper';
import type { ObjectStore } from '../../../../infrastructure/ports/object-store.port';
import { coerceRegistrationNumber } from '../normalize/coerce';

export type ExtractedImage = {
  fileName: string;
  key: string;
  registrationNumber: string;
};

export type ExtractImagesInput = {
  jobId: string;
  zipKey: string;
};

export type ExtractImagesOutput = {
  images: ExtractedImage[];
};

/**
 * Extract vehicle images from the dealer ZIP.
 *
 * ZIP entries are never written to the local filesystem.
 * Images are extracted in memory and stored through ObjectStore.
 */
export async function extractImagesStage(
  store: ObjectStore,
  input: ExtractImagesInput,
): Promise<ExtractImagesOutput> {
  const zipBuffer = await store.get(input.zipKey);

  const directory = await unzipper.Open.buffer(zipBuffer);

  const images: ExtractedImage[] = [];

  for (const entry of directory.files) {
    if (entry.type !== 'File') {
      continue;
    }

    const fileName = entry.path;

    // Prevent ZIP path traversal.
    const normalized = fileName.replace(/\\/g, '/');

    if (
      normalized.startsWith('/') ||
      normalized.includes('../') ||
      normalized.includes('..\\')
    ) {
      throw new Error(`Unsafe ZIP entry: ${fileName}`);
    }

    const extension = getExtension(normalized);

    if (!['jpg', 'jpeg', 'png', 'webp'].includes(extension)) {
      continue;
    }

    const baseName = getBaseName(normalized);

    /*
     * Expected naming:
     *
     * WPX1234.jpg
     * WPX1234_1.jpg
     * WPX1234_2.jpg
     *
     * The registration number is the part before the optional _number.
     */
    const registrationNumber = coerceRegistrationNumber(
      baseName.replace(/_\d+$/, ''),
    );

    if (!registrationNumber) {
      continue;
    }

    const body = await entry.buffer();

    if (!body.length) {
      continue;
    }

    const imageKey = `raw/${input.jobId}/images/${sanitizeKeyPart(fileName)}`;

    await store.put(imageKey, body, contentTypeFor(extension));

    images.push({
      fileName,
      key: imageKey,
      registrationNumber,
    });
  }

  return { images };
}

function getExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');

  if (index === -1) {
    return '';
  }

  return fileName.slice(index + 1).toLowerCase();
}

function getBaseName(fileName: string): string {
  const lastSlash = fileName.lastIndexOf('/');

  const name = lastSlash >= 0 ? fileName.slice(lastSlash + 1) : fileName;

  const dot = name.lastIndexOf('.');

  return dot >= 0 ? name.slice(0, dot) : name;
}

function sanitizeKeyPart(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((part) => part.replace(/[^a-zA-Z0-9._-]/g, '_'))
    .join('/');
}

function contentTypeFor(extension: string): string {
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';

    case 'png':
      return 'image/png';

    case 'webp':
      return 'image/webp';

    default:
      return 'application/octet-stream';
  }
}
