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

  getUploadTarget(
    key: string,
    contentType: string,
    expirySeconds: number,
  ): Promise<{ url: string; headers?: Record<string, string> }>;
}

/** DI token - `ObjectStore` is an interface and erases at runtime. */
export const OBJECT_STORE = Symbol('ObjectStore');
