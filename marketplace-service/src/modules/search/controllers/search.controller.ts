import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { FilterSearchResponseDto, VehicleDetailDto } from '../dto/filter-search-response.dto';
import { FilterSearchService } from '../services/filter-search.service';
import { NlSearchService } from '../services/nl-search.service';
import { SearchOptionsService } from '../services/search-options.service';
import { NlSearchDto } from '../dto/nl-search.dto';
import { NlSearchResponseDto } from '../dto/nl-search-response.dto';
import {
  SearchOptionsResponseDto,
  MarketplaceStatsDto,
} from '../dto/search-options-response.dto';
import { VehicleSearchRepository } from '../repositories/vehicle-search.repository';

@Controller('search')
export class SearchController {
  constructor(
    private readonly filterSearchService: FilterSearchService,
    private readonly nlSearchService: NlSearchService,
    private readonly optionsService: SearchOptionsService,
    private readonly repository: VehicleSearchRepository,
  ) {}

  // Main entry point — design doc §10's "UI filters" path. Straight to
  // WHERE, no tokenizing, no parser, no LLM, no vector.
  @Get('filters')
  async filterSearch(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto> {
    return this.filterSearchService.search(dto);
  }

  // Free-text path — SAD 4.1.4 / FR-21. Parser emits a FilterSearchDto and
  // this reuses the filter service (LIVE gate, relaxation, facets). Groq
  // and pgvector are not on this route yet.
  @Get('nl')
  async nlSearch(@Query() dto: NlSearchDto): Promise<NlSearchResponseDto> {
    return this.nlSearchService.search(dto);
  }

  // Standalone facet counts for the initial page load, before any filter
  // is applied — lets the sidebar render "SUV (14)" style counts on first
  // paint without waiting on a full search response.
  //
  // Goes straight to the repository rather than through search(): the full
  // search path would run the relaxation ladder, fetch a page of rows only
  // to discard them, and write an analytics row for a request the buyer
  // never made.
  @Get('facets')
  async facets(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto['facets']> {
    return this.repository.facets(dto);
  }

  // Landing-page headline figures. Every number is computed from live
  // inventory — nothing here is a hardcoded marketing figure.
  @Get('stats')
  async stats(): Promise<MarketplaceStatsDto> {
    return this.optionsService.getStats();
  }

  // Detail page for one listing.
  //
  // Lives here rather than on ListingController because vehicle ids are
  // UUIDs and that controller's @Param('id', ParseIntPipe) rejects every
  // real id with a 400. This route is also read-only and public, matching
  // the rest of search, whereas listings is the dealer-facing write surface.
  @Get('vehicles/:id')
  async vehicleById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<VehicleDetailDto> {
    const vehicle = await this.repository.findById(id);
    // findById already gates on status = 'LIVE', so a non-live listing is
    // indistinguishable from a missing one — deliberate: a direct link to a
    // DRAFT or SOLD vehicle must not confirm it exists.
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  // Dropdown values: enums from constants (cheap, static), makes/models
  // from vehicle_dictionaries (cacheable — changes rarely).
  @Get('options')
  async options(@Query('vehicleType') vehicleType?: string): Promise<SearchOptionsResponseDto> {
    return this.optionsService.getOptions(vehicleType);
  }
}
