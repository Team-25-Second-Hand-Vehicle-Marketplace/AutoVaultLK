import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { AuthUserView } from '../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../infrastructure/database/entities/dealer-profile.view-entity';
import { EtlStageLog } from '../infrastructure/database/entities/etl-stage-log.entity';
import { RejectedRecord } from '../infrastructure/database/entities/rejected-record.entity';
import { UploadJob } from '../infrastructure/database/entities/upload-job.entity';
import { VehicleDictionaryView } from '../infrastructure/database/entities/vehicle-dictionary.view-entity';
import { VehicleImageWriteEntity } from '../infrastructure/database/entities/vehicle-image.write-entity';
import { VehicleWriteEntity } from '../infrastructure/database/entities/vehicle.write-entity';


export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  url: process.env.INGESTION_DATABASE_URL,
  schema: 'ingestion',

  entities: [
    AuthUserView,
    DealerProfileView,
    EtlStageLog,
    RejectedRecord,
    UploadJob,
    VehicleDictionaryView,
    VehicleImageWriteEntity,
    VehicleWriteEntity,
  ],

  synchronize: false,

  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  extra: { max: 5 },
});
