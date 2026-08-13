import { BadRequestException } from '@nestjs/common';
import { buildFilterQuery } from './filter-query.builder';
import { FilterSearchDto } from '../dto/filter-search.dto';

/**
 * buildFilterQuery is a pure function with no database access, which makes
 * it the highest-value test target in the search module: every SQL-shaping
 * decision the feature depends on is observable from its return value alone.
 *
 * These tests deliberately assert on SQL fragments rather than just
 * parameter arrays. The distinction between `@>` and `->>` is invisible in
 * the results but is the difference between using a GIN index and a
 * sequential scan, so it is exactly the kind of thing a refactor can quietly
 * undo.
 */
describe('buildFilterQuery', () => {
  const build = (dto: Partial<FilterSearchDto>) => buildFilterQuery(dto as FilterSearchDto);

  describe('status gating', () => {
    it('always filters to LIVE listings, as the first clause', () => {
      const { whereSql, params } = build({});
      // Leading position matters: every search index is composited with
      // status first, so the planner needs it available up front.
      expect(whereSql.startsWith('v.status = $1')).toBe(true);
      expect(params[0]).toBe('LIVE');
    });

    it('gates on status even when no filters are supplied at all', () => {
      const { whereSql } = build({});
      expect(whereSql).toBe('v.status = $1');
    });
  });

  describe('column filters', () => {
    it('turns multi-value filters into a single ANY(...) clause', () => {
      const { whereSql, params } = build({ fuelType: ['PETROL', 'HYBRID'] as never });
      expect(whereSql).toContain('v.fuel_type = ANY($2::text[])');
      expect(params[1]).toEqual(['PETROL', 'HYBRID']);
    });

    it('parameterizes free-text values rather than concatenating them', () => {
      // make is buyer-supplied text; a naive builder would inline it.
      const { whereSql, params } = build({ make: ["O'Brien; DROP TABLE vehicles"] });
      expect(whereSql).toContain('v.make = ANY($2::text[])');
      expect(whereSql).not.toContain('DROP TABLE');
      expect(params[1]).toEqual(["O'Brien; DROP TABLE vehicles"]);
    });

    it('ignores empty arrays instead of emitting an unsatisfiable clause', () => {
      const { whereSql, appliedFilterKeys } = build({ make: [] });
      expect(whereSql).toBe('v.status = $1');
      expect(appliedFilterKeys).not.toContain('make');
    });
  });

  describe('year filtering (Decision 3)', () => {
    it('filters on COALESCE(registration_year, manufacture_year) by default', () => {
      // registration_year is nullable because dealers omit it. Filtering it
      // directly hides those listings from every year-filtered search with
      // no error — the single most costly bug this module has had.
      const { whereSql } = build({ minYear: 2015 });
      expect(whereSql).toContain('COALESCE(v.registration_year, v.manufacture_year) >= $2');
      expect(whereSql).not.toMatch(/[^(]v\.registration_year >=/);
    });

    it('narrows to registration_year only when the buyer opts in', () => {
      const { whereSql } = build({ minYear: 2015, hasRegistrationYear: true });
      expect(whereSql).toContain('v.registration_year IS NOT NULL');
      expect(whereSql).toContain('v.registration_year >= $2');
      expect(whereSql).not.toContain('COALESCE');
    });
  });

  describe('spec filters', () => {
    it('uses jsonb containment for enum specs so the GIN index applies', () => {
      const { whereSql, params } = build({ specs: [{ key: 'body_type', value: 'SUV' }] });
      // `@>` is index-usable; `specs->>'body_type' = 'SUV'` is not.
      expect(whereSql).toContain('v.specs @> $2::jsonb');
      expect(whereSql).not.toContain("->>'body_type'");
      expect(params[1]).toBe(JSON.stringify({ body_type: 'SUV' }));
    });

    it('ORs multiple values for the same key', () => {
      // A buyer checking SUV and SEDAN wants either. ANDing them describes a
      // vehicle that is both at once, which always returned zero rows.
      const { whereSql } = build({
        specs: [
          { key: 'body_type', value: 'SUV' },
          { key: 'body_type', value: 'SEDAN' },
        ],
      });
      expect(whereSql).toContain('(v.specs @> $2::jsonb OR v.specs @> $3::jsonb)');
    });

    it('ANDs values across different keys', () => {
      const { whereSql } = build({
        specs: [
          { key: 'body_type', value: 'SUV' },
          { key: 'drive_type', value: '4WD' },
        ],
      });
      expect(whereSql).toContain('v.specs @> $2::jsonb AND v.specs @> $3::jsonb');
      expect(whereSql).not.toContain('OR');
    });

    it('casts int specs, which containment cannot express', () => {
      const { whereSql, params } = build({ specs: [{ key: 'seats', value: '7' }] });
      expect(whereSql).toContain("(v.specs->>'seats')::int = $2");
      expect(params[1]).toBe(7);
    });

    it('coerces bool specs to real JSON booleans, not strings', () => {
      const { params } = build({ specs: [{ key: 'sunroof', value: 'true' }] });
      // '{"sunroof":"true"}' would never match '{"sunroof":true}' in jsonb.
      expect(params[1]).toBe(JSON.stringify({ sunroof: true }));
    });

    it('rejects unknown spec keys rather than passing them to Postgres', () => {
      expect(() => build({ specs: [{ key: 'nonexistent_key', value: 'x' }] })).toThrow(
        BadRequestException,
      );
    });

    it('rejects values outside an int spec declared range', () => {
      expect(() => build({ specs: [{ key: 'seats', value: '999' }] })).toThrow(BadRequestException);
    });

    it('rejects values outside an enum spec declared list', () => {
      expect(() => build({ specs: [{ key: 'body_type', value: 'SPACESHIP' }] })).toThrow(
        BadRequestException,
      );
    });
  });

  describe('keyword layer', () => {
    it('uses plainto_tsquery against search_vector', () => {
      const { whereSql, params } = build({ q: 'red toyota' });
      expect(whereSql).toContain("v.search_vector @@ plainto_tsquery('english', $2)");
      expect(params[1]).toBe('red toyota');
    });

    it('ignores a whitespace-only keyword', () => {
      const { whereSql, appliedFilterKeys } = build({ q: '   ' });
      expect(whereSql).toBe('v.status = $1');
      expect(appliedFilterKeys).not.toContain('q');
    });
  });

  describe('parameter numbering', () => {
    it('keeps placeholders sequential and aligned with the params array', () => {
      // Off-by-one numbering here is the classic way a builder like this
      // breaks: the SQL stays valid but binds the wrong values.
      const { whereSql, params } = build({
        vehicleType: ['CAR'] as never,
        minPrice: 1_000_000,
        maxPrice: 5_000_000,
        specs: [{ key: 'seats', value: '5' }],
        q: 'hybrid',
      });

      const placeholders = [...whereSql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
      expect(placeholders).toEqual([1, 2, 3, 4, 5, 6]);
      expect(params).toHaveLength(6);
    });
  });

  describe('appliedFilterKeys', () => {
    it('reports only the filters actually present', () => {
      const { appliedFilterKeys } = build({ make: ['Toyota'], maxPrice: 5_000_000 });
      expect(appliedFilterKeys).toEqual(['make', 'maxPrice']);
    });
  });
});
