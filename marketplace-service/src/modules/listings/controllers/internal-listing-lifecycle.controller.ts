import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';

import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { ListingLifecycleService } from '../services/listing-lifecycle.service';

/**
 * Called by the scheduler, never by the browser: archives expired listings and
 * purges old deletion snapshots. Protected by the internal service key.
 */
@Controller('internal/listing-lifecycle')
@UseGuards(InternalServiceGuard)
export class InternalListingLifecycleController {
  constructor(private readonly lifecycle: ListingLifecycleService) {}

  @Post('run')
  @HttpCode(HttpStatus.OK)
  run() {
    return this.lifecycle.runDailyJobs(new Date());
  }
}
