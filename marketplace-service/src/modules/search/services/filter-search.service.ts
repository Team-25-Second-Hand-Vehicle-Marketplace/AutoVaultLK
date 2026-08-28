import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { FilterSearchResponseDto, RelaxationDto } from '../dto/filter-search-response.dto';
import { buildFilterQuery } from '../filters/filter-query.builder';
import type { SearchRankOptions } from '../filters/search-rank';
import { VehicleSearchRepository } from '../repositories/vehicle-search.repository';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/vehicle-attributes.constants';


type RelaxationStep = { drop: string; label: string };

@Injectable()
export class FilterSearchService {
  private readonly logger = new Logger(FilterSearchService.name);

  constructor(
    private readonly repository: VehicleSearchRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}


  async search(
    dto: FilterSearchDto,
    log?: {
      rawText?: string;
      confidence?: number | null;
      unresolvedTokens?: string[];
      usedLlm?: boolean;
    },
    rank?: SearchRankOptions,
  ): Promise<FilterSearchResponseDto> {
    const startedAt = Date.now();
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const normalizedDto = { ...dto, page, limit };

    let built = buildFilterQuery(normalizedDto);
    let total = await this.repository.count(built, normalizedDto.verifiedDealersOnly, rank);
    let relaxation: RelaxationDto | undefined;

    let effectiveDto: FilterSearchDto = normalizedDto;


    if (total === 0) {
      const result = await this.relax(normalizedDto);
      if (result) {
        built = result.built;
        total = result.total;
        relaxation = result.relaxation;
        effectiveDto = result.dto;
      }
    }

    const [items, facets] = await Promise.all([
      this.repository.search(built, effectiveDto, rank),
      normalizedDto.facets ? this.repository.facets(effectiveDto) : undefined,
    ]);

    this.logSearch(normalizedDto, total, Date.now() - startedAt, log).catch((err) =>
      this.logger.warn(`search_queries logging failed: ${err.message}`),
    );

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      appliedFilters: this.toPlainFilters(dto),
      facets,
      relaxation,
    };
  }

  private async relax(dto: FilterSearchDto): Promise<{
    built: ReturnType<typeof buildFilterQuery>;
    total: number;
    relaxation: RelaxationDto;
    dto: FilterSearchDto;
  } | null> {
    const steps: Array<{
      apply: (d: FilterSearchDto) => FilterSearchDto;
      applies: (d: FilterSearchDto) => boolean;
      step: RelaxationStep;
    }> = [

      {
        applies: (d) => (d.specs?.length ?? 0) > 0,
        apply: (d) => ({ ...d, specs: undefined }),
        step: { drop: 'specs', label: 'vehicle spec filters' },
      },
      {

        applies: (d) => (d.q?.trim().length ?? 0) > 0,
        apply: (d) => ({ ...d, q: undefined }),
        step: { drop: 'q', label: 'keyword search' },
      },
      {

        applies: (d) => d.hasRegistrationYear === true,
        apply: (d) => ({ ...d, hasRegistrationYear: undefined }),
        step: { drop: 'hasRegistrationYear', label: 'the confirmed-registration-year requirement' },
      },
      {
        applies: (d) => d.minMileage !== undefined || d.maxMileage !== undefined,
        apply: (d) => ({
          ...d,
          minMileage: widen(d.minMileage, -0.15),
          maxMileage: widen(d.maxMileage, 0.15),
        }),
        step: { drop: 'mileageRange', label: 'mileage range (widened 15%)' },
      },
      {
        applies: (d) => d.minYear !== undefined || d.maxYear !== undefined,
        apply: (d) => ({
          ...d,
          minYear: d.minYear !== undefined ? d.minYear - 1 : d.minYear,
          maxYear: d.maxYear !== undefined ? d.maxYear + 1 : d.maxYear,
        }),
        step: { drop: 'yearRange', label: 'year range (widened by 1 year)' },
      },
    ];

    const droppedFilters: string[] = [];
    const labels: string[] = [];
    let current = dto;

    for (const { apply, applies, step } of steps) {
      if (!applies(current)) continue;

      current = apply(current);
      droppedFilters.push(step.drop);
      labels.push(step.label);

      const built = buildFilterQuery(current);
      const total = await this.repository.count(built, current.verifiedDealersOnly);
      if (total > 0) {
        const priceCeilingExceeded = dto.maxPrice !== undefined;
        const what = formatList(labels);
        return {
          built,
          total,
          dto: current,
          relaxation: {
            droppedFilters,
            priceCeilingExceeded,
            message: priceCeilingExceeded
              ? `No exact matches — showing results after relaxing ${what}. Some results may exceed your budget.`
              : `No exact matches — showing results after relaxing ${what}.`,
          },
        };
      }
    }

    return null; // truly nothing matches, even fully relaxed — return the empty result as-is
  }

  private async logSearch(
    dto: FilterSearchDto,
    resultCount: number,
    elapsedMs: number,
    log?: {
      rawText?: string;
      confidence?: number | null;
      unresolvedTokens?: string[];
      usedLlm?: boolean;
    },
  ): Promise<void> {

    await this.dataSource.query(
      `INSERT INTO marketplace.search_queries
         (raw_text, extracted_filters, used_llm, unresolved_tokens, result_count, search_time_ms, confidence)
       VALUES ($1, $2::jsonb, $3, $4::jsonb, $5, $6, $7)`,
      [
        log?.rawText ?? '',
        JSON.stringify(this.toPlainFilters(dto)),
        log?.usedLlm ?? false,
        JSON.stringify(log?.unresolvedTokens ?? []),
        resultCount,
        elapsedMs,
        log?.confidence ?? null,
      ],
    );
  }

  private toPlainFilters(dto: FilterSearchDto): Record<string, unknown> {
    const { page, limit, facets, ...filters } = dto;
    return Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined));
  }
}

function widen(value: number | undefined, fraction: number): number | undefined {
  if (value === undefined) return value;
  return Math.round(value * (1 + fraction));
}

/** "a", "a and b", "a, b and c" — for the buyer-facing relaxation message. */
function formatList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
