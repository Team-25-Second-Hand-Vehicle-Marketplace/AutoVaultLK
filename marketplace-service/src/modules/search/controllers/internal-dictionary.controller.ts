import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InternalServiceGuard } from '../../../common/guards/internal-service.guard';
import { AliasPromotionRepository } from '../repositories/alias-promotion.repository';
import {
  AddDictionaryAliasDto,
  CreateDictionaryEntryDto,
} from '../dto/internal-dictionary.dto';

@Controller('internal/dictionary')
@UseGuards(InternalServiceGuard)
export class InternalDictionaryController {
  constructor(private readonly repository: AliasPromotionRepository) {}

  @Post()
  async create(@Body() dto: CreateDictionaryEntryDto) {
    try {
      return await this.repository.createEntry(
        dto.dictionaryType,
        dto.canonicalValue.trim(),
      );
    } catch (err) {
      throw new ConflictException(
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  @Post(':id/aliases')
  async addAlias(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddDictionaryAliasDto,
  ) {
    const added = await this.repository.addAlias(id, dto.alias.trim());
    if (!added) {
      throw new BadRequestException(
        'Alias was not added - the dictionary entry may not exist, or already has this alias',
      );
    }
    return { added: true };
  }
}
