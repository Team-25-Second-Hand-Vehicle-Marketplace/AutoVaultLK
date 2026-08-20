import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import {
  DealerProfile,
  VerificationStatus,
} from '../../../infrastructure/database/entities/dealer-profile.entity';
import { User } from '../../../infrastructure/database/entities/user.entity';
import { CreateDealerProfileDto } from '../dto/create-dealer-profile.dto';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerProfilesRepository } from '../repositories/dealer-profiles.repository';
import { UsersRepository } from '../../users/repositories/users.repository';

@Injectable()
export class DealerProfilesService {
  constructor(
    private readonly dealerProfilesRepository: DealerProfilesRepository,
    private readonly usersRepository: UsersRepository,
    private readonly dataSource: DataSource,
  ) {}

  findAll() {
    return this.dealerProfilesRepository.findAll();
  }

  async findByUserId(userId: string) {
    const profile = await this.dealerProfilesRepository.findByUserId(userId);
    if (!profile) {
      throw new NotFoundException(
        `Dealer profile for user ${userId} was not found`,
      );
    }
    return profile;
  }

  create(data: CreateDealerProfileDto) {
    return this.dealerProfilesRepository.create(data);
  }

  async update(userId: string, data: UpdateDealerProfileDto) {
    await this.findByUserId(userId);
    return this.dealerProfilesRepository.update(userId, data);
  }

  async approveDealer(dealerUserId: string, adminId: string) {
    return this.decideVerification(
      dealerUserId,
      adminId,
      VerificationStatus.VERIFIED,
      true,
    );
  }

  async rejectDealer(dealerUserId: string, adminId: string, reason?: string) {
    return this.decideVerification(
      dealerUserId,
      adminId,
      VerificationStatus.REJECTED,
      false,
      reason,
    );
  }

  private async decideVerification(
    dealerUserId: string,
    adminId: string,
    status: VerificationStatus,
    activateAccount: boolean,
    reason?: string,
  ) {
    const profile = await this.findByUserId(dealerUserId);

    if (profile.verificationStatus !== VerificationStatus.PENDING) {
      throw new BadRequestException(
        `Dealer verification is already ${profile.verificationStatus}`,
      );
    }

    const admin = await this.usersRepository.findById(adminId);
    if (!admin || admin.role !== 'ADMIN') {
      throw new NotFoundException(`Administrator with ID ${adminId} was not found`);
    }

    const decidedAt = new Date();

    return this.dataSource.transaction(async (manager) => {
      const profileUpdate = await manager.update(
        DealerProfile,
        { userId: dealerUserId },
        {
          verificationStatus: status,
          verifiedBy: adminId,
          verifiedAt: decidedAt,
          // Clear any earlier reason on approve, so a re-approved profile does
          // not keep displaying why it was once rejected.
          rejectionReason: status === VerificationStatus.REJECTED ? (reason ?? null) : null,
        },
      );

      if (!profileUpdate.affected) {
        throw new NotFoundException(
          `Dealer profile for user ${dealerUserId} was not found`,
        );
      }

      const userUpdate = await manager.update(
        User,
        { id: dealerUserId },
        { isActive: activateAccount },
      );

      if (!userUpdate.affected) {
        throw new NotFoundException(
          `Dealer user ${dealerUserId} was not found`,
        );
      }

      const updated = await manager.findOne(DealerProfile, {
        where: { userId: dealerUserId },
      });

      if (!updated) {
        throw new NotFoundException(
          `Dealer profile for user ${dealerUserId} was not found`,
        );
      }

      return updated;
    });
  }
}
