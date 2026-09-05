import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthUserView } from '../../infrastructure/database/entities/auth-user.view-entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    TypeOrmModule.forFeature([AuthUserView]),
  ],
  providers: [JwtStrategy, JwtAuthGuard],
  exports: [JwtAuthGuard, PassportModule],
})
export class JwtAuthModule {}
