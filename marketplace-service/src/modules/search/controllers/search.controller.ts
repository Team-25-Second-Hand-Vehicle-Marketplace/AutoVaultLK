import { Controller, Get, Query } from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { FilterSearchResponseDto } from '../dto/filter-search-response.dto';
import { FilterSearchService } from '../services/filter-search.service';
import { SearchOptionsService } from '../services/search-options.service';
import { SearchOptionsResponseDto } from '../dto/search-options-response.dto';

@Controller('search')
export class SearchController {
  constructor(
    private readonly filterSearchService: FilterSearchService,
    private readonly optionsService: SearchOptionsService,
  ) {}

  // Main entry point — design doc §10's "UI filters" path. Straight to
  // WHERE, no tokenizing, no parser, no LLM, no vector.
  @Get('filters')
  async filterSearch(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto> {
    return this.filterSearchService.search(dto);
  }

  // Standalone facet counts for the initial page load, before any filter
  // is applied — lets the sidebar render "SUV (14)" style counts on first
  // paint without waiting on a full search response.
  @Get('facets')
  async facets(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto['facets']> {
    const result = await this.filterSearchService.search({ ...dto, facets: true, limit: 1 });
    return result.facets;
  }

  // Dropdown values: enums from constants (cheap, static), makes/models
  // from vehicle_dictionaries (cacheable — changes rarely).
  @Get('options')
  async options(@Query('vehicleType') vehicleType?: string): Promise<SearchOptionsResponseDto> {
    return this.optionsService.getOptions(vehicleType);
  }
}
