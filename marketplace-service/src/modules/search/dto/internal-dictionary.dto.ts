import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const DICTIONARY_TYPES = ['MAKE', 'MODEL', 'BODY_TYPE', 'COLOR'] as const;

/** Body for POST /internal/dictionary - admin-service creating a new canonical entry. */
export class CreateDictionaryEntryDto {
  @IsIn(DICTIONARY_TYPES, {
    message: 'dictionaryType must be one of MAKE, MODEL, BODY_TYPE, COLOR',
  })
  dictionaryType!: (typeof DICTIONARY_TYPES)[number];

  @IsString()
  @MinLength(1, { message: 'canonicalValue is required' })
  @MaxLength(100, { message: 'canonicalValue must be at most 100 characters' })
  canonicalValue!: string;
}

/** Body for POST /internal/dictionary/:id/aliases - admin-service adding an alias. */
export class AddDictionaryAliasDto {
  @IsString()
  @MinLength(1, { message: 'alias is required' })
  @MaxLength(100, { message: 'alias must be at most 100 characters' })
  alias!: string;
}
