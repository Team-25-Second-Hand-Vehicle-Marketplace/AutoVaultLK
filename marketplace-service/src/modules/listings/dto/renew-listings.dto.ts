import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { LISTING_TERM_DAYS } from '../listing-expiry';

/** Upper bound for one renew request; a dealer with more renews in batches. */
export const MAX_RENEW_IDS = 1000;

/**
 * Renews a dealer's LIVE listings in one request. With `ids`, only those listings
 * are renewed. With `expiringWithinDays`, only listings expiring that soon. With
 * neither, every LIVE listing the dealer owns is renewed.
 */
export class RenewListingsDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(MAX_RENEW_IDS)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  ids?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(LISTING_TERM_DAYS)
  expiringWithinDays?: number;
}
