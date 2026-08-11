import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { databaseConfig } from './config/database.config';

import { HealthModule } from './health/health.module';

import { DealerModule } from './modules/dealers/dealer.module';
import { ListingModule } from './modules/listings/listing.module';
import { SearchModule } from './modules/search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../.env', '.env'],
    }),

    TypeOrmModule.forRoot(databaseConfig()),

    HealthModule,

    DealerModule,

    ListingModule,

    SearchModule,
  ],
})
export class AppModule {}
