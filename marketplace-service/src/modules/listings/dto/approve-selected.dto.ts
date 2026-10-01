import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Upper bound for one request; a dealer with more selects in batches. */
export const MAX_APPROVE_SELECTED = 1000;

/** The listings a dealer ticked on My listings and chose to approve together. */
export class ApproveSelectedDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_APPROVE_SELECTED)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids: string[];
}
