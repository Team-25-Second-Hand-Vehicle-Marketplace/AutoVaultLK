import { createReadStream, type Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ObjectStore } from '../ports/object-store.port';

/**
 * Filesystem-backed ObjectStore for local development and CI (ADR-007). Keys
 * map to paths beneath INGESTION_STORAGE_ROOT.
 *
 * Keys are built from dealer-supplied filenames, so every key is resolved and
 * re-checked against the root before any I/O. A key like `../../etc/passwd` is
 * inert in an S3 bucket — the flat namespace has no parent directories — but on
 * a real filesystem it escapes. That asymmetry is the whole reason this class
 * validates and S3ObjectStore will not need to.
 */
@Injectable()
export class LocalObjectStore implements ObjectStore {
  private readonly logger = new Logger(LocalObjectStore.name);
  private readonly root: string;

  constructor(config: ConfigService) {
    this.root = resolve(config.get<string>('INGESTION_STORAGE_ROOT') ?? '.storage');
    this.logger.log(`Local object store rooted at ${this.root}`);
  }

  async put(key: string, body: Buffer | string): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return key;
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.pathFor(key));
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const path = this.pathFor(key);
    // stat first so a missing key rejects here, rather than surfacing later as
    // an 'error' event on a stream the caller has already started piping.
    await stat(path);
    return createReadStream(path);
  }

  async exists(key: string): Promise<boolean> {
    // Validate outside the try: an invalid or escaping key is a caller bug
    // and must surface, whereas a missing file is a legitimate `false`.
    // Catching both together would report a traversal attempt as simply
    // "not found".
    const path = this.pathFor(key);

    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  /** Recursive, to match S3's flat-namespace prefix listing. Returns keys. */
  async list(prefix: string): Promise<string[]> {
    const base = this.pathFor(prefix);
    const keys: string[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: Dirent<string>[];
      try {
        entries = (await readdir(dir, { withFileTypes: true })) as Dirent<string>[];
      } catch {
        // A prefix that matches nothing is an empty listing in S3, not an error.
        return;
      }

      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else {
          // Keys are always POSIX-style, even when produced on Windows.
          keys.push(relative(this.root, full).split(sep).join(posix.sep));
        }
      }
    };

    await walk(base);
    return keys.sort();
  }

  /**
   * Resolves a key to an absolute path and refuses anything outside the root.
   * Checked after resolution rather than by scanning for '..', because
   * 'a/../../b' only reveals itself as an escape once normalized.
   */
  private pathFor(key: string): string {
    if (!key || isAbsolute(key) || key.includes('\0')) {
      throw new Error(`Invalid object key: ${JSON.stringify(key)}`);
    }

    const path = resolve(this.root, key);
    const rel = relative(this.root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`Object key escapes the storage root: ${key}`);
    }

    return path;
  }
}
