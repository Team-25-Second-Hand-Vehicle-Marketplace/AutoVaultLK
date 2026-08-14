import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../../infrastructure/database/entities/refresh-token.entity';
import { SecurityEvent } from '../../infrastructure/database/entities/security-event.entity';
import { User } from '../../infrastructure/database/entities/user.entity';
import { DealerProfilesModule } from '../dealers/dealers.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { JwtAuthModule } from './jwt-auth.module';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { SecurityEventsRepository } from './repositories/security-events.repository';
import { AuthAbuseProtectionService } from './services/auth-abuse-protection.service';
import { AuthService } from './services/auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken, SecurityEvent]),
    JwtAuthModule,
    UsersModule,
    DealerProfilesModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthAbuseProtectionService,
    RefreshTokensRepository,
    SecurityEventsRepository,
  ],
  exports: [AuthService, JwtAuthModule],
})
export class AuthModule {}
