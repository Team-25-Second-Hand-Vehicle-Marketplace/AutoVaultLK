import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Put,
} from '@nestjs/common';

import { DealerService } from '../services/dealer.service';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Controller('dealers')
export class DealerController {
  constructor(
    private readonly dealerService: DealerService,
  ) {}

  @Get('profile')
  getProfile() {
    return this.dealerService.getProfile();
  }

  @Get(':id')
  getDealerById(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.dealerService.getDealerById(id);
  }

  @Put('profile')
  updateProfile(
    @Body() dto: UpdateDealerProfileDto,
  ) {
    return this.dealerService.updateProfile(dto);
  }
}