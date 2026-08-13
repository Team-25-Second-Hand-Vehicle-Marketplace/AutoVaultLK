import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Joi from 'joi';
import { databaseConfig } from './config/database.config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { DealerProfilesModule } from './modules/dealers/dealers.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      validationSchema: Joi.object({
        PORT: Joi.number().port().default(3001),
        AUTH_DATABASE_URL: Joi.string().uri().required(),
        JWT_ACCESS_SECRET: Joi.string().min(32).required(),
        JWT_ISSUER: Joi.string().min(3).default('autovault-lk-auth'),
        JWT_AUDIENCE: Joi.string().min(3).default('autovault-lk-api'),
        JWT_ALGORITHM: Joi.string().valid('HS256').default('HS256'),
        JWT_ACCESS_EXPIRES_IN: Joi.string()
        // The regex pattern /^\d+[smhd]$/ matches a string that starts with one or more digits (\d+), followed by a single character that can be either 's', 'm', 'h', or 'd'. This pattern is commonly used to represent time durations, where:
          .pattern(/^\d+[smhd]$/)
          .default('15m'),
        JWT_REFRESH_EXPIRES_IN: Joi.string()
          .pattern(/^\d+[smhd]$/)
          .default('7d'),
        MAX_ACTIVE_REFRESH_SESSIONS: Joi.number().integer().min(1).max(50).default(5),
        AUTH_LOGIN_MAX_ATTEMPTS: Joi.number().integer().min(1).max(20).default(5),
        AUTH_LOGIN_LOCKOUT_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
        AUTH_LOGIN_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
        AUTH_IP_MAX_ATTEMPTS: Joi.number().integer().min(1).max(1000).default(20),
        AUTH_REGISTER_MAX_PER_IP: Joi.number().integer().min(1).max(100).default(5),
        AUTH_REGISTER_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(60),
        AUTH_REFRESH_MAX_PER_IP: Joi.number().integer().min(1).max(1000).default(30),
        AUTH_REFRESH_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(15),
        AUTH_PASSWORD_RESET_MAX_PER_EMAIL: Joi.number().integer().min(1).max(50).default(3),
        AUTH_PASSWORD_RESET_WINDOW_MINUTES: Joi.number().integer().min(1).max(1440).default(60),
        AUTH_PROGRESSIVE_DELAY_BASE_MS: Joi.number().integer().min(0).max(5000).default(250),
        AUTH_PROGRESSIVE_DELAY_MAX_MS: Joi.number().integer().min(0).max(30000).default(4000),
        INTERNAL_SERVICE_KEY: Joi.string().min(16).required(),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    DatabaseModule,
    AuthModule,
    UsersModule,
    DealerProfilesModule,
    HealthModule,
  ],
})
export class AppModule {}
