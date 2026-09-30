import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user.type';
import { JobStatusResponseDto } from '../dto/job-status-response.dto';
import { JobsQueryDto } from '../dto/jobs-query.dto';
import type { JobsResponseDto } from '../dto/jobs-response.dto';
import { RejectionsQueryDto } from '../dto/rejections-query.dto';
import type { RejectionsResponseDto } from '../dto/rejections-response.dto';
import { JobStatusService } from '../services/job-status.service';

@UseGuards(JwtAuthGuard)
// Route is `jobs`, not `upload-jobs`: api-gateway/openapi/public-api.yaml
// publishes GET /jobs/{jobId} and api-gateway/local/nginx.conf proxies
// `location /jobs/` WITHOUT stripping the prefix, so the path the service
// sees is /jobs/<id>.
@Controller('jobs')
export class JobStatusController {
  constructor(private readonly jobStatusService: JobStatusService) {}

  /**
   * Lets the Bulk Upload page find its way back to an in-progress job after
   * the dealer navigates away and returns. Registered before ':id' so
   * "active" is never parsed as a job id.
   */
  @Get('active')
  async getActiveJob(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ id: string } | null> {
    return this.jobStatusService.getActiveJob(user.id);
  }

  /**
   * The dealer's own upload history — lets the Bulk Upload area point back at
   * a past job's rejection report after the dealer has navigated away, not
   * just the one that happens to still be running. Registered before ':id'
   * for the same reason as 'active': Nest would otherwise parse "mine" as a
   * job id.
   */
  @Get('mine')
  async listJobs(
    @Query() query: JobsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobsResponseDto> {
    return this.jobStatusService.listJobs(user.id, query);
  }

  @Get(':id')
  async getJobStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JobStatusResponseDto> {
    return this.jobStatusService.getJobStatus(id, user.id);
  }

  /**
   * FR-57: the row-level error report behind the aggregate counts on
   * GET /jobs/{id}. Paginated — a file where every row failed would otherwise
   * return the entire batch in one response.
   */
  @Get(':id/rejections')
  async getRejections(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: RejectionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RejectionsResponseDto> {
    return this.jobStatusService.getRejectedRecords(id, user.id, query);
  }
}
