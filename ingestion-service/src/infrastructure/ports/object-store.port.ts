/**
 * Blob storage boundary. Backed by the local filesystem today and by S3 once
 * the service is deployed (ADR-007) - no pipeline stage or application service
 * may import an AWS SDK directly, so swapping the driver stays a one-line
 * change in StorageModule rather than an edit to every stage.
 *
 * Keys are POSIX-style, forward-slash separated, and always relative:
 *
 *   raw/{jobId}/{fileName}            immutable dealer upload
 *   staging/{jobId}/chunk-{n}.json    inter-stage payloads (~7-day S3 lifecycle)
 *   images/{jobId}/{vehicleId}/...    processed images + thumbnails
 *
 * Keys derive from dealer-supplied filenames, so an implementation backed by a
 * real filesystem MUST reject any key that escapes its root - see
 * LocalObjectStore.
 */
export interface ObjectStore {
  /** Writes the object and returns the key it was stored under. */
  put(
    key: string,
    body: Buffer | string,
    contentType?: string,
  ): Promise<string>;

  /** Reads a whole object. Throws if the key does not exist. */
  get(key: string): Promise<Buffer>;

  /**
   * Streams an object - used for the CSV split and ZIP extraction, where
   * buffering a whole dealer upload into memory is not acceptable.
   */
  getStream(key: string): Promise<NodeJS.ReadableStream>;

  exists(key: string): Promise<boolean>;

  /** Recursive, matching S3's flat-namespace prefix listing. Returns keys. */
  list(prefix: string): Promise<string[]>;

  /**
   * A URL the *browser* can PUT a file's bytes to directly, bypassing this
   * service entirely for the transfer itself. API Gateway hard-caps a
   * Lambda-proxied request body at 10 MB (not a configurable quota) - well
   * under a dealer's CSV (up to 25 MB) or photo ZIP (up to 250 MB), so those
   * can never reliably arrive as part of a normal request in production. The
   * caller presigns this once, the browser PUTs straight to storage, then
   * tells the service the upload finished.
   */
  getUploadTarget(
    key: string,
    contentType: string,
    expirySeconds: number,
  ): Promise<{ url: string; headers?: Record<string, string> }>;
}

/** DI token - `ObjectStore` is an interface and erases at runtime. */
export const OBJECT_STORE = Symbol('ObjectStore');
