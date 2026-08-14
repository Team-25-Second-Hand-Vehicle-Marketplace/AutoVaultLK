import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SecurityModule } from '../../src/common/security/security.module';
import { HealthController } from '../../src/health/health.controller';
import { AuthController } from '../../src/modules/auth/controllers/auth.controller';
import { getAccessTokenSignOptions } from '../../src/modules/auth/config/jwt.config';
import { JwtAuthGuard } from '../../src/modules/auth/guards/jwt-auth.guard';
import { ResourceOwnerGuard } from '../../src/modules/auth/guards/resource-owner.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { EmailVerificationTokensRepository } from '../../src/modules/auth/repositories/email-verification-tokens.repository';
import { PasswordHistoryRepository } from '../../src/modules/auth/repositories/password-history.repository';
import { PasswordResetTokensRepository } from '../../src/modules/auth/repositories/password-reset-tokens.repository';
import { RefreshTokensRepository } from '../../src/modules/auth/repositories/refresh-tokens.repository';
import { SecurityEventsRepository } from '../../src/modules/auth/repositories/security-events.repository';
import { AuthAbuseProtectionService } from '../../src/modules/auth/services/auth-abuse-protection.service';
import { AuthService } from '../../src/modules/auth/services/auth.service';
import { EmailVerificationService } from '../../src/modules/auth/services/email-verification.service';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { JwtStrategy } from '../../src/modules/auth/strategies/jwt.strategy';
import { DealerProfilesController } from '../../src/modules/dealers/controllers/dealer-profiles.controller';
import { InternalDealersController } from '../../src/modules/dealers/controllers/internal-dealers.controller';
import { DealerProfilesRepository } from '../../src/modules/dealers/repositories/dealer-profiles.repository';
import { DealerProfilesService } from '../../src/modules/dealers/services/dealer-profiles.service';
import { UsersController } from '../../src/modules/users/controllers/users.controller';
import { UsersRepository } from '../../src/modules/users/repositories/users.repository';
import { UsersService } from '../../src/modules/users/services/users.service';
import { DataSource } from 'typeorm';
import {
  buildE2eConfiguration,
  buildE2eValidationSchema,
} from './e2e-config';
import { IN_MEMORY_STORE, InMemoryAuthStore } from './in-memory-auth-store';
import {
  InMemoryDealerProfilesRepository,
  InMemoryEmailVerificationTokensRepository,
  InMemoryPasswordHistoryRepository,
  InMemoryPasswordResetTokensRepository,
  InMemoryRefreshTokensRepository,
  InMemorySecurityEventsRepository,
  InMemoryUsersRepository,
  createInMemoryDataSource,
} from './in-memory-repositories';

const coreProviders = [
  {
    provide: IN_MEMORY_STORE,
    useFactory: () => new InMemoryAuthStore(),
  },
  {
    provide: DataSource,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) => createInMemoryDataSource(store),
  },
  {
    provide: UsersRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) => new InMemoryUsersRepository(store),
  },
  {
    provide: DealerProfilesRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemoryDealerProfilesRepository(store),
  },
  {
    provide: RefreshTokensRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemoryRefreshTokensRepository(store),
  },
  {
    provide: SecurityEventsRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemorySecurityEventsRepository(store),
  },
  {
    provide: EmailVerificationTokensRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemoryEmailVerificationTokensRepository(store),
  },
  {
    provide: PasswordResetTokensRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemoryPasswordResetTokensRepository(store),
  },
  {
    provide: PasswordHistoryRepository,
    inject: [IN_MEMORY_STORE],
    useFactory: (store: InMemoryAuthStore) =>
      new InMemoryPasswordHistoryRepository(store),
  },
  AuthService,
  AuthAbuseProtectionService,
  EmailVerificationService,
  PasswordService,
  UsersService,
  DealerProfilesService,
  JwtStrategy,
  JwtAuthGuard,
  RolesGuard,
  ResourceOwnerGuard,
];

@Module({})
export class AuthE2eModule {
  static register(
    envOverrides: Record<string, string> = {},
  ): DynamicModule {
    const configuration = buildE2eConfiguration(envOverrides);

    return {
      module: AuthE2eModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => configuration],
          validationSchema: buildE2eValidationSchema(),
          validationOptions: {
            allowUnknown: true,
            abortEarly: false,
          },
        }),
        SecurityModule,
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.registerAsync({
          imports: [ConfigModule],
          inject: [ConfigService],
          useFactory: (configService: ConfigService) =>
            getAccessTokenSignOptions(configService),
        }),
      ],
      controllers: [
        AuthController,
        UsersController,
        DealerProfilesController,
        InternalDealersController,
        HealthController,
      ],
      providers: coreProviders,
      exports: [IN_MEMORY_STORE, UsersRepository],
    };
  }
}
