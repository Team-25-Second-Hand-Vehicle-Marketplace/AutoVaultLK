import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';

import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { DealerVerificationDto } from '../dto/dealer-verification.dto';
import { DealerProfilesService } from '../services/dealer-profiles.service';

/**
 * East-west routes for admin-service (internal-api.yaml / ADR-005).
 * Not on the public nginx listener. Requires X-Internal-Service-Key;
 * admin identity is validated in DealerProfilesService.decideVerification.
 */
@Controller('internal/dealers')
@UseGuards(InternalServiceGuard)
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
