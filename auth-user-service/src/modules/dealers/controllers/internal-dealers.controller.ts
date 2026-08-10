import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';

import { DealerVerificationDto } from '../dto/dealer-verification.dto';
import { DealerProfilesService } from '../services/dealer-profiles.service';

/** Internal-only routes for admin-service (internal-api.yaml). */
@Controller('internal/dealers')
export class InternalDealersController {
  constructor(private readonly dealerProfilesService: DealerProfilesService) {}

  @Post(':id/approve')
  approveDealer(
    @Param('id', ParseUUIDPipe) dealerUserId: string,
    @Body() dto: DealerVerificationDto,
  ) {
    return this.dealerProfilesService.approveDealer(dealerUserId, dto.adminId);
  }

  @Post(':id/reject')
  rejectDealer(
    @Param('id', ParseUUIDPipe) dealerUserId: string,
    @Body() dto: DealerVerificationDto,
  ) {
    return this.dealerProfilesService.rejectDealer(dealerUserId, dto.adminId);
  }
}
