import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RefreshToken } from '../../infrastructure/database/entities/refresh-token.entity';
import { User } from '../../infrastructure/database/entities/user.entity';
import { DealerProfilesModule } from '../dealers/dealers.module';
import { UsersModule } from '../users/users.module';
import { AuthController } from './controllers/auth.controller';
import { JwtAuthModule } from './jwt-auth.module';
import { RefreshTokensRepository } from './repositories/refresh-tokens.repository';
import { AuthService } from './services/auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshToken]),
    JwtAuthModule,
    UsersModule,
    DealerProfilesModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, RefreshTokensRepository],
  exports: [AuthService, JwtAuthModule],
})
export class AuthModule {}
