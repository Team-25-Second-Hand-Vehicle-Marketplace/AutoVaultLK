import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { verificationDocumentsError } from '../../../common/validation/verification-documents.decorator';
import {
  DealerProfile,
  VerificationStatus,
} from '../../../infrastructure/database/entities/dealer-profile.entity';
import { CreateDealerProfileDto } from '../dto/create-dealer-profile.dto';
import { ResubmitDealerProfileDto } from '../dto/resubmit-dealer-profile.dto';
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
    return this.decideVerification(dealerUserId, adminId, VerificationStatus.VERIFIED);
  }

  async rejectDealer(dealerUserId: string, adminId: string, reason?: string) {
    return this.decideVerification(dealerUserId, adminId, VerificationStatus.REJECTED, reason);
  }

  /**
   * A rejected dealer fixing their details and trying again. Its own action
   * rather than a side effect on the generic `update()` above, so an already
   * VERIFIED dealer editing their address is never silently sent back to
   * PENDING - only this explicit path can do that, and only from REJECTED.
   */
  async resubmit(userId: string, data: ResubmitDealerProfileDto) {
    const profile = await this.findByUserId(userId);

    if (profile.verificationStatus !== VerificationStatus.REJECTED) {
      throw new ConflictException(
        `Dealer profile is ${profile.verificationStatus}, not REJECTED - nothing to resubmit`,
      );
    }

    const docError = verificationDocumentsError(profile.dealerType, data.verificationDocuments);
    if (docError) {
      throw new BadRequestException(docError);
    }

    return this.dealerProfilesRepository.update(userId, {
      ...data,
      verificationStatus: VerificationStatus.PENDING,
      rejectionReason: null,
    });
  }

  /**
   * `isActive` is not touched here - a dealer's ability to authenticate is
   * decided once, on email verification (see EmailVerificationService), the
   * same as a buyer. Only DealerProfile fields change on approve/reject; see
   * assertManualUploadAllowed (marketplace-service) and
   * isVerifiedBusinessDealer (ingestion-service) for where verificationStatus
   * actually gates anything.
   */
  private async decideVerification(
    dealerUserId: string,
    adminId: string,
    status: VerificationStatus,
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
