import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../../infrastructure/database/entities/user.entity';
import { UsersController } from './controllers/users.controller';
import { UsersRepository } from './repositories/users.repository';
import { UsersService } from './services/users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [UsersController],
  providers: [UsersRepository, UsersService],
  exports: [UsersRepository, UsersService],
})
export class UsersModule {}
