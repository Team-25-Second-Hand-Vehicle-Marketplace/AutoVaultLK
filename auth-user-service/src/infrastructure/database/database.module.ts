import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DealerProfile } from './entities/dealer-profile.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { User } from './entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([User, DealerProfile, RefreshToken])],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
