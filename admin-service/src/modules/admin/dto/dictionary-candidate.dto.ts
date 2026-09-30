import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/** Body for POST /admin/dictionary-candidates/add-make. */
export class AddDictionaryMakeDto {
  @IsString()
  @MinLength(1, { message: 'rawValue is required' })
  @MaxLength(100)
  rawValue!: string;

  @IsString()
  @MinLength(1, { message: 'canonicalValue is required' })
  @MaxLength(100)
  canonicalValue!: string;
}

/** Body for POST /admin/dictionary-candidates/add-alias. */
export class AddDictionaryAliasDto {
  @IsString()
  @MinLength(1, { message: 'rawValue is required' })
  @MaxLength(100)
  rawValue!: string;

  @IsString()
  @MinLength(1, { message: 'aliasText is required' })
  @MaxLength(100)
  aliasText!: string;

  @IsUUID('4', { message: 'dictionaryId must be a valid UUID' })
  dictionaryId!: string;
}

/** Body for POST /admin/dictionary-candidates/dismiss. */
export class DismissDictionaryCandidateDto {
  @IsString()
  @MinLength(1, { message: 'rawValue is required' })
  @MaxLength(100)
  rawValue!: string;
}
