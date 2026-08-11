import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { FilterSearchDto } from '../dto/filter-search.dto';
import { FilterSearchResponseDto, RelaxationDto } from '../dto/filter-search-response.dto';
import { buildFilterQuery } from '../filters/filter-query.builder';
import { VehicleSearchRepository } from '../repositories/vehicle-search.repository';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/vehicle-attributes.constants';

/**
 * Zero-result relaxation order — design doc §8: drop the least-committal
 * constraint first. specs are the most speculative (a buyer's "nice to
 * have"), so they go first; numeric ranges widen next; price is NEVER
 * dropped, only flagged, because a buyer's budget is a hard constraint they
 * stated explicitly.
 */
type RelaxationStep = { drop: string; label: string };

@Injectable()
export class FilterSearchService {
  private readonly logger = new Logger(FilterSearchService.name);

  constructor(
    private readonly repository: VehicleSearchRepository,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async search(dto: FilterSearchDto): Promise<FilterSearchResponseDto> {
    const startedAt = Date.now();
    const page = dto.page ?? 1;
    const limit = Math.min(dto.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const normalizedDto = { ...dto, page, limit };

    let built = buildFilterQuery(normalizedDto);
    let total = await this.repository.count(built, normalizedDto.verifiedDealersOnly);
    let relaxation: RelaxationDto | undefined;

    if (total === 0) {
      const result = await this.relax(normalizedDto);
      if (result) {
        built = result.built;
        total = result.total;
        relaxation = result.relaxation;
      }
    }

    const [items, facets] = await Promise.all([
      this.repository.search(built, normalizedDto),
      normalizedDto.facets ? this.repository.facets(built, normalizedDto.verifiedDealersOnly) : undefined,
    ]);

    this.logSearch(normalizedDto, total, Date.now() - startedAt).catch((err) =>
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

  /**
   * §8: relax the weakest filter, or return nearest matches with a notice.
   * Tries each step in order, re-counting after each drop, and stops at the
   * first step that produces results. Price is handled separately — it is
   * flagged in the response, never dropped from the query.
   */
  private async relax(
    dto: FilterSearchDto,
  ): Promise<{ built: ReturnType<typeof buildFilterQuery>; total: number; relaxation: RelaxationDto } | null> {
    const steps: Array<{ apply: (d: FilterSearchDto) => FilterSearchDto; step: RelaxationStep }> = [
      {
        apply: (d) => ({ ...d, specs: undefined }),
        step: { drop: 'specs', label: 'vehicle spec filters' },
      },
      {
        apply: (d) => ({
          ...d,
          minMileage: widen(d.minMileage, -0.15),
          maxMileage: widen(d.maxMileage, 0.15),
        }),
        step: { drop: 'mileageRange', label: 'mileage range (widened 15%)' },
      },
      {
        apply: (d) => ({
          ...d,
          minYear: d.minYear !== undefined ? d.minYear - 1 : d.minYear,
          maxYear: d.maxYear !== undefined ? d.maxYear + 1 : d.maxYear,
        }),
        step: { drop: 'yearRange', label: 'year range (widened by 1 year)' },
      },
      {
        apply: (d) => {
          const withoutSeats = d.specs?.filter((s) => s.key !== 'seats');
          return { ...d, specs: withoutSeats };
        },
        step: { drop: 'seats', label: 'seat count' },
      },
    ];

    const droppedFilters: string[] = [];
    let current = dto;

    for (const { apply, step } of steps) {
      current = apply(current);
      droppedFilters.push(step.drop);
      const built = buildFilterQuery(current);
      const total = await this.repository.count(built, current.verifiedDealersOnly);
      if (total > 0) {
        const priceCeilingExceeded = dto.maxPrice !== undefined;
        return {
          built,
          total,
          relaxation: {
            droppedFilters,
            priceCeilingExceeded,
            message: priceCeilingExceeded
              ? `No exact matches — showing results after relaxing ${step.label}. Some results may exceed your budget.`
              : `No exact matches — showing results after relaxing ${step.label}.`,
          },
        };
      }
    }

    return null; // truly nothing matches, even fully relaxed — return the empty result as-is
  }

  private async logSearch(dto: FilterSearchDto, resultCount: number, elapsedMs: number): Promise<void> {
    // Fire-and-forget by design (caller wraps in .catch) — analytics must
    // never fail a search. usedLlm is always false on this path; this
    // table is shared with the future NL pipeline (search_queries schema
    // already accounts for both).
    await this.dataSource.query(
      `INSERT INTO marketplace.search_queries
         (raw_text, extracted_filters, used_llm, unresolved_tokens, result_count, search_time_ms)
       VALUES ($1, $2::jsonb, false, '[]'::jsonb, $3, $4)`,
      ['', JSON.stringify(this.toPlainFilters(dto)), resultCount, elapsedMs],
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
