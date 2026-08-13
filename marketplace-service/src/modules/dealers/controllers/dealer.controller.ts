import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';

import { DealerService } from '../services/dealer.service';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';

@Controller('dealers')
export class DealerController {
  constructor(
    private readonly dealerService: DealerService,
  ) {}

  @Get(':id/profile')
  getProfile(@Param('id', ParseUUIDPipe) id: string) {
    return this.dealerService.getProfile(id);
  }

  @Get(':id')
  getDealerById(@Param('id', ParseUUIDPipe) id: string) {
    return this.dealerService.getDealerById(id);
  }

  @Put(':id/profile')
  updateProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDealerProfileDto,
  ) {
    return this.dealerService.updateProfile(id, dto);
  }
}
