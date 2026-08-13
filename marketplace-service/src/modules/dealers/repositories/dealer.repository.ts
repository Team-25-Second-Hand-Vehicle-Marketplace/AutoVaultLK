import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AuthUserView } from '../../../infrastructure/database/entities/auth-user.view-entity';
import { DealerProfileView } from '../../../infrastructure/database/entities/dealer-profile.view-entity';

export type DealerSummary = {
  id: string;
  businessName: string;
  ownerName: string;
  email: string;
  phone: string | null;
  city: string;
  verificationStatus: string;
};

@Injectable()
export class DealerRepository {
  constructor(
    @InjectRepository(AuthUserView)
    private readonly userRepo: Repository<AuthUserView>,
    @InjectRepository(DealerProfileView)
    private readonly profileRepo: Repository<DealerProfileView>,
  ) {}

  async findById(id: string): Promise<DealerSummary | null> {
    const user = await this.userRepo.findOne({
      where: { id, role: 'DEALER', isActive: true },
    });

    if (!user) {
      return null;
    }

    const profile = await this.profileRepo.findOne({ where: { userId: id } });

    if (!profile) {
      return null;
    }

    return this.toSummary(user, profile);
  }

  findProfile(id: string) {
    return this.findById(id);
  }

  private toSummary(user: AuthUserView, profile: DealerProfileView): DealerSummary {
    return {
      id: user.id,
      businessName: profile.companyName,
      ownerName: user.name,
      email: user.email,
      phone: profile.contactNumber,
      city: profile.city,
      verificationStatus: profile.verificationStatus,
    };
  }
}
