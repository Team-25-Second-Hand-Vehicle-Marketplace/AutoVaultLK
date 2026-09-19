import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORE } from '../ports/object-store.port';
import { LocalObjectStore } from './local-object-store';
import { S3ObjectStore } from './s3-object-store';

/**
 * Selects the ObjectStore driver from INGESTION_STORAGE_DRIVER.
 *
 * An unknown driver throws rather than falling back to `local`: a
 * half-configured deployment must not silently write dealer uploads to a
 * container's ephemeral disk, where they would vanish on the next cold start
 * with the job row still claiming success.
 *
 * S3ObjectStore validates its own bucket at construction, so a missing
 * INGESTION_S3_BUCKET fails here at boot rather than on the first upload.
 */
@Global()
@Module({
  providers: [
    {
      provide: OBJECT_STORE,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const driver = config.get<string>('INGESTION_STORAGE_DRIVER') ?? 'local';

        switch (driver) {
          case 'local':
            return new LocalObjectStore(config);
          case 's3':
            return new S3ObjectStore(config);
          default:
            throw new Error(`Unknown INGESTION_STORAGE_DRIVER: ${driver}`);
        }
      },
    },
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
