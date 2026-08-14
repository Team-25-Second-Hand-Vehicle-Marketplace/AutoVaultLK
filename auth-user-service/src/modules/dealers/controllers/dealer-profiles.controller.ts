import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CreateDealerProfileDto } from '../dto/create-dealer-profile.dto';
import { UpdateDealerProfileDto } from '../dto/update-dealer-profile.dto';
import { DealerProfilesService } from '../services/dealer-profiles.service';

@Controller('dealer-profiles')
export class DealerProfilesController {
  constructor(
    private readonly dealerProfilesService: DealerProfilesService,
  ) {}

  @Get()
  findAll() {
    return this.dealerProfilesService.findAll();
  }

  @Get(':userId')
  findByUserId(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.dealerProfilesService.findByUserId(userId);
  }

  @Post()
  create(@Body() data: CreateDealerProfileDto) {
    return this.dealerProfilesService.create(data);
  }

  @Patch(':userId')
  update(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() data: UpdateDealerProfileDto,
  ) {
    return this.dealerProfilesService.update(userId, data);
  }
}
