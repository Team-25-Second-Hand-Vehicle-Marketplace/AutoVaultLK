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

/**
 * East-west routes for admin-service's "New vehicle types" tab (ADR-005).
 * Not on the public nginx listener. Requires X-Internal-Service-Key.
 *
 * marketplace_service_role owns the only write access to
 * marketplace.vehicle_dictionaries — admin-service can only SELECT it, so an
 * admin's "add this make" / "add this alias" decision has to reach the
 * dictionary through here rather than a direct write from admin-service's
 * own connection, the same reason auth-user-service's internal/dealers
 * routes exist for approve/reject.
 */
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
        'Alias was not added — the dictionary entry may not exist, or already has this alias',
      );
    }
    return { added: true };
  }
}
