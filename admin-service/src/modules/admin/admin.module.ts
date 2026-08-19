import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditLog } from '../../infrastructure/database/entities/audit-log.entity';
import { AuthUserView } from '../../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../infrastructure/database/entities/dealer-profile.view-entity';
import { NotificationView } from '../../infrastructure/database/entities/notification.view-entity';
import { UploadJobView } from '../../infrastructure/database/entities/upload-job.view-entity';
import { VehicleView } from '../../infrastructure/database/entities/vehicle.view-entity';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { AuthInternalClient } from './clients/auth-internal.client';
import { NotificationInternalClient } from './clients/notification-internal.client';
import { AdminController } from './controllers/admin.controller';
import { AdminReadsRepository } from './repositories/admin-reads.repository';
import { AuditLogsRepository } from './repositories/audit-logs.repository';
import { AdminMutationsService } from './services/admin-mutations.service';
import { AdminReadsService } from './services/admin-reads.service';

@Module({
  imports: [
    JwtAuthModule,
    TypeOrmModule.forFeature([
      AuditLog,
      AuthUserView,
      DealerProfileView,
      NotificationView,
      UploadJobView,
      VehicleView,
    ]),
  ],
  controllers: [AdminController],
  providers: [
    AdminReadsRepository,
    AuditLogsRepository,
    AdminReadsService,
    AdminMutationsService,
    AuthInternalClient,
    NotificationInternalClient,
  ],
})
export class AdminModule {}
