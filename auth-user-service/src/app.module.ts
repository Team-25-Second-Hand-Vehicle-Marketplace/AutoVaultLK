import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import Joi from 'joi';
import { databaseConfig } from './config/database.config';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './infrastructure/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
      validationSchema: Joi.object({
        PORT: Joi.number().port().default(3000),
        AUTH_DATABASE_URL: Joi.string().uri({ scheme: [/^(postgres|postgresql)$/] }).required(),
      }),
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    TypeOrmModule.forRoot(databaseConfig()),
    DatabaseModule,
    HealthModule,
  ],
})
export class AppModule {}
