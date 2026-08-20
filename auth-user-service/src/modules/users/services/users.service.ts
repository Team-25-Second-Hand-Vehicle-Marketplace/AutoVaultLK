import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { AdminUpdateUserDto } from '../dto/admin-update-user.dto';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UsersRepository } from '../repositories/users.repository';

type PublicUser = Omit<User, 'passwordHash' | 'failedLoginAttempts' | 'lockedUntil'>;

@Injectable()
export class UsersService {
  constructor(private readonly usersRepository: UsersRepository) {}

  findAll() {
    return this.usersRepository.findAll().then((users) => users.map((user) => this.toPublicUser(user)));
  }

  async findById(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} was not found`);
    }
    return this.toPublicUser(user);
  }

  findByEmail(email: string) {
    return this.usersRepository.findByEmail(email);
  }

  async create(data: CreateUserDto) {
    const created = await this.usersRepository.create({
      email: data.email,
      name: data.name,
      passwordHash: await bcrypt.hash(data.password, 12),
      role: 'BUYER',
    });
    return this.findById(created.id);
  }

  async update(id: string, data: UpdateUserDto) {
    await this.findById(id);
    const updated = await this.usersRepository.update(id, data);
    return this.toPublicUser(updated);
  }

  async adminUpdate(id: string, data: AdminUpdateUserDto) {
    await this.findById(id);
    const updated = await this.usersRepository.update(id, data);
    return this.toPublicUser(updated);
  }

  async deactivate(userId: string, adminId: string) {
    if (adminId === userId) {
      throw new ForbiddenException(
        'Administrators cannot change their own role or account status',
      );
    }

    const admin = await this.usersRepository.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException(`Administrator with ID ${adminId} was not found`);
    }

    return this.adminUpdate(userId, { isActive: false });
  }

  /**
   * Reverses deactivate. FR-11 requires deactivation to preserve historical
   * data rather than delete it, which only makes sense if the account can be
   * restored — otherwise "not deleted" is a distinction without a difference.
   */
  async reactivate(userId: string, adminId: string) {
    if (adminId === userId) {
      throw new ForbiddenException(
        'Administrators cannot change their own role or account status',
      );
    }

    const admin = await this.usersRepository.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException(`Administrator with ID ${adminId} was not found`);
    }

    return this.adminUpdate(userId, { isActive: true });
  }

  /**
   * FR-12: ADMIN accounts are never publicly registerable. They come from the
   * database seed or from an existing administrator — this is that second
   * path, reachable only through the internal service key.
   */
  async createAdmin(input: { email: string; name: string; password: string }, adminId: string) {
    const admin = await this.usersRepository.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException(`Administrator with ID ${adminId} was not found`);
    }

    const existing = await this.usersRepository.findByEmail(input.email);
    if (existing) {
      throw new ConflictException(`Email ${input.email} is already registered`);
    }

    const created = await this.usersRepository.create({
      email: input.email,
      name: input.name,
      passwordHash: await bcrypt.hash(input.password, 12),
      role: 'ADMIN',
      isActive: true,
    });

    return this.toPublicUser(created);
  }

  private toPublicUser(user: User): PublicUser {
    const {
      passwordHash: _passwordHash,
      failedLoginAttempts: _failedLoginAttempts,
      lockedUntil: _lockedUntil,
      ...publicUser
    } = user;
    return publicUser;
  }
}
