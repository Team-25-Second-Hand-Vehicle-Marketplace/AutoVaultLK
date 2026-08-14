import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { getAccessTokenSignOptions } from './config/jwt.config';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { ResourceOwnerGuard } from './guards/resource-owner.guard';
import { RolesGuard } from './guards/roles.guard';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        getAccessTokenSignOptions(configService),
    }),
    forwardRef(() => UsersModule),
  ],
  providers: [JwtStrategy, JwtAuthGuard, RolesGuard, ResourceOwnerGuard],
  exports: [
    JwtAuthGuard,
    RolesGuard,
    ResourceOwnerGuard,
    JwtModule,
    PassportModule,
  ],
})
export class JwtAuthModule {}
