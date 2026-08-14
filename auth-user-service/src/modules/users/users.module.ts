import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../infrastructure/database/entities/user.entity';
import { JwtAuthModule } from '../auth/jwt-auth.module';
import { InternalUsersController } from './controllers/internal-users.controller';
import { UsersController } from './controllers/users.controller';
import { UsersRepository } from './repositories/users.repository';
import { UsersService } from './services/users.service';
import { InternalServiceGuard } from '../../common/guards/internal-service.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User]), forwardRef(() => JwtAuthModule)],
  controllers: [UsersController, InternalUsersController],
  providers: [UsersRepository, UsersService, InternalServiceGuard],
  exports: [UsersRepository, UsersService],
})
export class UsersModule {}
