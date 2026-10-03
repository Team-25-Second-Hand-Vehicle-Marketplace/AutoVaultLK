import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectStore } from '../ports/object-store.port';

@Injectable()
export class S3ObjectStore implements ObjectStore {
  private readonly logger = new Logger(S3ObjectStore.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigService) {
    const bucket = config.get<string>('INGESTION_S3_BUCKET')?.trim();
    if (!bucket) {
      // Failing at construction rather than on the first write: a service that
      // starts, accepts an upload and only then discovers it has nowhere to put
      // it has already told the dealer their file was received.
      throw new Error(
        'INGESTION_S3_BUCKET must be set when INGESTION_STORAGE_DRIVER=s3',
      );
    }

    this.bucket = bucket;
    this.client = new S3Client({
      region: config.get<string>('AWS_REGION'),
      // Credentials come from the Lambda execution role or the ambient
      // provider chain. Never from config - a key in an env var is a key in a
      // process listing.
    });

    this.logger.log(`S3 object store using bucket ${this.bucket}`);
  }

  /**
   * Uses lib-storage's Upload rather than PutObjectCommand: it switches to a
   * multipart upload above 5 MB on its own, and a dealer's 25 MB CSV is past
   * the point where a single PUT is a good idea.
   */
  async put(
    key: string,
    body: Buffer | string,
    contentType?: string,
  ): Promise<string> {
    assertKey(key);

    await new Upload({
      client: this.client,
      params: {
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ...(contentType ? { ContentType: contentType } : {}),
      },
    }).done();

    return key;
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);

    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    if (!response.Body) {
      throw new Error(`S3 object ${key} has no body`);
    }

    // transformToByteArray is the SDK's own helper and handles the
    // Node-vs-browser stream difference for us.
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    assertKey(key);

    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );

    const body = response.Body;
    if (!body) {
      throw new Error(`S3 object ${key} has no body`);
    }

    if (body instanceof Readable) return body;

    // A web ReadableStream - the shape the SDK returns outside Node.
    return Readable.fromWeb(
      body as unknown as Parameters<typeof Readable.fromWeb>[0],
    );
  }

  /**
   * HeadObject rather than GetObject: it costs no transfer and a missing key
   * is the expected case for a caller asking whether something exists.
   */
  async exists(key: string): Promise<boolean> {
    assertKey(key);

    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) return false;
      // A permissions failure is not a missing object, and reporting it as one
      // would send the pipeline looking for a file it was simply not allowed
      // to see.
      throw err;
    }
  }

  /**
   * Pages through the listing. S3 caps a response at 1000 keys, and a job with
   * more chunks than that would otherwise silently list only the first page -
   * the pipeline would then process a prefix of the file and report success.
   */
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );

      for (const object of response.Contents ?? ([] as _Object[])) {
        if (object.Key) keys.push(object.Key);
      }

      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);

    // LocalObjectStore sorts, and callers rely on chunk keys arriving in
    // order. S3 returns lexicographic order already, but sorting here means
    // the two drivers cannot disagree.
    return keys.sort();
  }

  /**
   * Signs locally (SigV4) - never calls AWS, so this costs a little CPU, not
   * a network round trip. The browser must send the exact same Content-Type
   * back as a header, or S3 rejects the PUT with a signature mismatch -
   * that's what pins the upload to the type the dealer actually picked.
   */
  async getUploadTarget(
    key: string,
    contentType: string,
    expirySeconds: number,
  ): Promise<{ url: string; headers?: Record<string, string> }> {
    assertKey(key);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: expirySeconds,
    });

    return { url, headers: { 'Content-Type': contentType } };
  }
}

/**
 * S3 has no directories, so traversal is not a threat - but an empty key or one
 * containing a null byte is a caller bug in either driver, and failing here
 * beats an opaque XML error from the service.
 */
function assertKey(key: string): void {
  if (!key || key.includes('\0')) {
    throw new Error(`Invalid object key: ${JSON.stringify(key)}`);
  }
}

function isNotFound(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
    ?.$metadata?.httpStatusCode;

  return name === 'NotFound' || name === 'NoSuchKey' || status === 404;
}
