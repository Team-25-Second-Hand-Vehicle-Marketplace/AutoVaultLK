import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORE } from '../ports/object-store.port';
import { LocalObjectStore } from './local-object-store';

/**
 * Selects the ObjectStore driver from INGESTION_STORAGE_DRIVER.
 *
 * `s3` is recognised and throws rather than falling back to `local`: a
 * half-configured deployment must not silently write dealer uploads to a
 * container's ephemeral disk, where they would vanish on the next cold start
 * with the job row still claiming success.
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
            throw new Error(
              'INGESTION_STORAGE_DRIVER=s3 is not implemented yet (ADR-007). ' +
                'Add S3ObjectStore alongside LocalObjectStore and register it here.',
            );
          default:
            throw new Error(`Unknown INGESTION_STORAGE_DRIVER: ${driver}`);
        }
      },
    },
  ],
  exports: [OBJECT_STORE],
})
export class StorageModule {}
