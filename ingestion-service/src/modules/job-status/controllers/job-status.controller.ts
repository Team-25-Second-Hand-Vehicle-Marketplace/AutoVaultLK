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
