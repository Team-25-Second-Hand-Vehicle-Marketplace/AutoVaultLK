import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OBJECT_STORE } from '../ports/object-store.port';
import { LocalObjectStore } from './local-object-store';
import { S3ObjectStore } from './s3-object-store';

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
