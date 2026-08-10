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
