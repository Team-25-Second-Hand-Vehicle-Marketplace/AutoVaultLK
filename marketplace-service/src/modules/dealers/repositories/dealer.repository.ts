import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../../infrastructure/database/entities/dealer-profile.view-entity';

export interface DealerSummary {
  id: string;
  name: string;
  email: string;
  companyName: string;
  contactNumber: string | null;
  dealerType: string;
  businessRegistrationNumber: string;
  businessAddress: string;
  city: string;
  verificationStatus: string;
}

@Injectable()
export class DealerRepository {
  constructor(
    @InjectRepository(DealerProfileView)
    private readonly dealerProfiles: Repository<DealerProfileView>,
    @InjectRepository(AuthUserView)
    private readonly users: Repository<AuthUserView>,
  ) {}

  async findById(id: string): Promise<DealerSummary | null> {
    const profile = await this.findProfileWithUser(id);

    return profile ? this.toSummary(profile) : null;
  }

  async findByIds(ids: string[]): Promise<DealerSummary[]> {
    const uniqueIds = [...new Set(ids)];

    if (uniqueIds.length === 0) {
      return [];
    }

    const profiles = await this.dealerProfiles.find({
      where: {
        userId: In(uniqueIds),
        user: {
          role: 'DEALER',
          isActive: true,
        },
      },
      relations: {
        user: true,
      },
    });

    return profiles.map((profile) => this.toSummary(profile));
  }

  async exists(id: string): Promise<boolean> {
    const count = await this.dealerProfiles.count({
      where: {
        userId: id,
        user: {
          role: 'DEALER',
          isActive: true,
        },
      },
      relations: {
        user: true,
      },
    });

    return count > 0;
  }

  async userExists(id: string): Promise<boolean> {
    return this.users.exists({
      where: {
        id,
        role: 'DEALER',
        isActive: true,
      },
    });
  }

  private findProfileWithUser(
    id: string,
  ): Promise<DealerProfileView | null> {
    return this.dealerProfiles.findOne({
      where: {
        userId: id,
        user: {
          role: 'DEALER',
          isActive: true,
        },
      },
      relations: {
        user: true,
      },
    });
  }

  private toSummary(profile: DealerProfileView): DealerSummary {
    return {
      id: profile.userId,
      name: profile.user?.name ?? '',
      email: profile.user?.email ?? '',
      companyName: profile.companyName,
      contactNumber: profile.contactNumber,
      dealerType: profile.dealerType,
      businessRegistrationNumber:
        profile.businessRegistrationNumber,
      businessAddress: profile.businessAddress,
      city: profile.city,
      verificationStatus: profile.verificationStatus,
    };
  }
}
