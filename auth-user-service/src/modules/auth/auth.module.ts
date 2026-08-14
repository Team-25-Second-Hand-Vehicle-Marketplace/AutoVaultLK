import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailVerificationToken } from '../../infrastructure/database/entities/email-verification-token.entity';
import { RefreshToken } from '../../infrastructure/database/entities/refresh-token.entity';
import { SecurityEvent } from '../../infrastructure/database/entities/security-event.entity';
import { User } from '../../infrastructure/database/entities/user.entity';
import { DealerProfilesModule } from '../dealers/dealers.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { JwtAuthModule } from './jwt-auth.module';
import { EmailVerificationTokensRepository } from './repositories/email-verification-tokens.repository';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { SecurityEventsRepository } from './repositories/security-events.repository';
import { AuthAbuseProtectionService } from './services/auth-abuse-protection.service';
import { AuthService } from './services/auth.service';
import { EmailVerificationService } from './services/email-verification.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      RefreshToken,
      SecurityEvent,
      EmailVerificationToken,
    ]),
    JwtAuthModule,
    UsersModule,
    DealerProfilesModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthAbuseProtectionService,
    EmailVerificationService,
    RefreshTokensRepository,
    SecurityEventsRepository,
    EmailVerificationTokensRepository,
  ],
  exports: [AuthService, JwtAuthModule],
})
export class AuthModule {}
