import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { JobStatusResponseDto } from '../dto/job-status-response.dto';
import { JobStatusService } from '../services/job-status.service';

@UseGuards(JwtAuthGuard)
// Route is `jobs`, not `upload-jobs`: api-gateway/openapi/public-api.yaml
// publishes GET /jobs/{jobId} and api-gateway/local/nginx.conf proxies
// `location /jobs/` WITHOUT stripping the prefix, so the path the service
// sees is /jobs/<id>.
@Controller('jobs')
export class JobStatusController {
  constructor(private readonly jobStatusService: JobStatusService) {}

  @Get(':id')
  async getJobStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobStatusResponseDto> {
    return this.jobStatusService.getJobStatus(id, user.id);
  }
}
