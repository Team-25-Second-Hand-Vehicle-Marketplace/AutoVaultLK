import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /admin/dealers/:id/reject.
 *
 * FR-09 requires the rejection to trigger an email. A bare "rejected" tells
 * the dealer nothing about what to fix and gives the audit trail no record of
 * why the decision was made, so the reason travels into both.
 *
 * Optional for backwards compatibility: the admin UI currently posts an empty
 * body, and that call must keep working until the frontend sends a reason.
 */
export class RejectDealerDto {
  @IsOptional()
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason?: string;
}
