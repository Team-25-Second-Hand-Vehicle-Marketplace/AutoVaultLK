import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DealerProfileView } from '../../../infrastructure/database/entities/dealer-profile.view-entity';

/**
 * Read-only access to auth.dealer_profiles for the upload gate.
 *
 * POST /ingest/upload is documented as "business dealer, verified"
 * (api-gateway/openapi/public-api.yaml), which is two conditions, not one:
 * an individual dealer with VERIFIED status must still be refused bulk upload.
 */
@Injectable()
export class DealerProfileRepository {
  constructor(
    @InjectRepository(DealerProfileView)
    private readonly repo: Repository<DealerProfileView>,
  ) {}

  async findByUserId(userId: string): Promise<DealerProfileView | null> {
    return this.repo.findOne({ where: { userId } });
  }

  /**
   * True only for a VERIFIED business dealer. A missing profile is false, not
   * an error — a BUYER holding a valid JWT simply has no dealer profile, and
   * the caller turns that into 403 rather than 500.
   */
  async isVerifiedBusinessDealer(userId: string): Promise<boolean> {
    const profile = await this.findByUserId(userId);

    return (
      profile?.dealerType === 'business' && profile.verificationStatus === 'VERIFIED'
    );
  }
}
