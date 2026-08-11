import {
  Body,
  Controller,
  Get,
  Param,
  Put,
} from '@nestjs/common';

import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerService } from '../services/dealer.service';

@Controller('dealers')
export class DealerController {
  constructor(
    private readonly dealerService: DealerService,
  ) {}

  @Get(':id/profile')
  getProfile(
    @Param('id') id: string,
  ) {
    return this.dealerService.getProfile(id);
  }

  @Get(':id')
  getDealerById(
    @Param('id') id: string,
  ) {
    return this.dealerService.getDealerById(id);
  }

  @Put(':id/profile')
  updateProfile(
    @Param('id') id: string,
    @Body() dto: UpdateDealerProfileDto,
  ) {
    return this.dealerService.updateProfile(id, dto);
  }
}
