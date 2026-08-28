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

  @Get('filters')
  async filterSearch(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto> {
    return this.filterSearchService.search(dto);
  }

  @Get('nl')
  async nlSearch(@Query() dto: NlSearchDto): Promise<NlSearchResponseDto> {
    return this.nlSearchService.search(dto);
  }

  @Get('facets')
  async facets(@Query() dto: FilterSearchDto): Promise<FilterSearchResponseDto['facets']> {
    return this.repository.facets(dto);
  }

  @Get('stats')
  async stats(): Promise<MarketplaceStatsDto> {
    return this.optionsService.getStats();
  }

  @Get('vehicles/:id')
  async vehicleById(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<VehicleDetailDto> {
    const vehicle = await this.repository.findById(id);
    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }
    return vehicle;
  }

  @Get('options')
  async options(@Query('vehicleType') vehicleType?: string): Promise<SearchOptionsResponseDto> {
    return this.optionsService.getOptions(vehicleType);
  }
}
