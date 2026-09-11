import {
  buildSearchText,
  type SearchTextFields,
} from '../../../../src/shared/normalize-embed/search-text';

/**
 * buildSearchText is the contract between ingestion and search (FR-22.1): both
 * must turn an equivalent listing into byte-identical text, or the embeddings
 * they produce are not comparable.
 *
 * The parity spec proves the two copies agree; this one pins what they agree
 * ON — the field set, the ordering and the band boundaries — so a change is a
 * deliberate act with a re-embed attached, not an accident.
 */
describe('buildSearchText', () => {
  const YEAR = new Date().getFullYear();

  const full: SearchTextFields = {
    make: 'Toyota',
    model: 'Aqua',
    manufactureYear: 2015,
    vehicleType: 'CAR',
    condition: 'USED',
    fuelType: 'HYBRID',
    transmissionType: 'AUTOMATIC',
    price: 3_500_000,
    mileage: 45_000,
    locationCity: 'Colombo',
    locationDistrict: 'Colombo',
    specs: { body_type: 'Hatchback' },
    description: 'Well maintained',
  };

  it('joins every field in a fixed order', () => {
    expect(buildSearchText({ ...full, manufactureYear: YEAR - 8 })).toBe(
      `Toyota Aqua ${YEAR - 8} CAR USED HYBRID AUTOMATIC Colombo Colombo Hatchback ` +
        'mid range moderately priced moderate mileage used Well maintained',
    );
  });

  it('stringifies the manufacture year', () => {
    expect(buildSearchText({ ...full, manufactureYear: 2020 })).toContain(' 2020 ');
  });

  it('omits null and undefined optionals rather than leaving gaps', () => {
    expect(
      buildSearchText({
        make: 'Honda',
        model: 'Vezel',
        manufactureYear: YEAR - 8,
        vehicleType: 'SUV',
        condition: null,
        fuelType: null,
        transmissionType: undefined,
        price: null,
        mileage: null,
        locationCity: null,
        locationDistrict: null,
        specs: null,
        description: null,
      }),
    ).toBe(`Honda Vezel ${YEAR - 8} SUV used`);
  });

  it('pulls body_type out of specs but ignores non-string values', () => {
    expect(buildSearchText({ ...full, specs: { body_type: 42 } })).not.toContain('42');
    expect(buildSearchText({ ...full, specs: {} })).not.toContain('Hatchback');
  });

  describe('price bands', () => {
    // MiniLM tokenizes "3500000" as digit fragments with no numeric meaning:
    // 3.5M and 3.4M are not near each other in vector space. A band is a
    // phrase the model has seen in context, which is what lets "cheap family
    // car" reach a budget listing. Exact filtering stays a SQL WHERE clause.
    it.each([
      [1_500_000, 'budget affordable low price'],
      [3_500_000, 'mid range moderately priced'],
      [7_000_000, 'upper mid range'],
      [18_000_000, 'premium expensive'],
      [40_000_000, 'luxury high end'],
    ])('maps %d to "%s"', (price, band) => {
      expect(buildSearchText({ ...full, price })).toContain(band);
    });

    it('never emits the raw figure', () => {
      expect(buildSearchText({ ...full, price: 3_500_000 })).not.toContain('3500000');
    });

    it('omits the band for a missing or nonsensical price', () => {
      expect(buildSearchText({ ...full, price: null })).not.toMatch(/budget|range|premium|luxury/);
      expect(buildSearchText({ ...full, price: 0 })).not.toMatch(/budget|range|premium|luxury/);
      expect(buildSearchText({ ...full, price: -5 })).not.toMatch(/budget|range|premium|luxury/);
    });
  });

  describe('mileage bands', () => {
    it.each([
      [5_000, 'low mileage lightly used'],
      [45_000, 'moderate mileage'],
      [90_000, 'high mileage'],
      [200_000, 'very high mileage well used'],
    ])('maps %d to "%s"', (mileage, band) => {
      expect(buildSearchText({ ...full, mileage })).toContain(band);
    });

    it('treats zero mileage as low, not missing', () => {
      // A brand-new vehicle legitimately reads 0 km.
      expect(buildSearchText({ ...full, mileage: 0 })).toContain('low mileage');
    });
  });

  describe('age bands', () => {
    // Buyers search in relative terms — "recent model", "old car" — while the
    // year alone only matches a query naming that year.
    it.each([
      [YEAR - 1, 'brand new recent model'],
      [YEAR - 4, 'nearly new'],
      [YEAR - 8, 'used'],
      [YEAR - 15, 'older model'],
      [YEAR - 30, 'vintage old'],
    ])('maps year %d to "%s"', (year, band) => {
      expect(buildSearchText({ ...full, manufactureYear: year })).toContain(band);
    });

    it('omits the band for a future year rather than emitting a negative age', () => {
      const text = buildSearchText({ ...full, manufactureYear: YEAR + 5 });
      expect(text).not.toMatch(/brand new|nearly new|older model|vintage/);
    });
  });

  describe('equipment terms', () => {
    it('emits true boolean specs as words', () => {
      const text = buildSearchText({
        ...full,
        specs: { body_type: 'Sedan', sunroof: true, alloy_wheels: true },
      });

      expect(text).toContain('alloy wheels');
      expect(text).toContain('sunroof');
    });

    it('omits false and absent equipment', () => {
      // "no sunroof" would pull the listing toward queries mentioning
      // sunroofs, which is the opposite of what the dealer stated.
      const text = buildSearchText({ ...full, specs: { body_type: 'Sedan', sunroof: false } });

      expect(text).not.toContain('sunroof');
    });

    it('ignores non-boolean spec values', () => {
      const text = buildSearchText({
        ...full,
        specs: { body_type: 'Sedan', seats: 5, colour: 'Pearl White' },
      });

      expect(text).not.toContain('Pearl White');
      expect(text).not.toContain('seats');
    });

    it('does not repeat body_type as an equipment term', () => {
      const text = buildSearchText({ ...full, specs: { body_type: 'Sedan' } });

      expect(text.match(/Sedan/g)).toHaveLength(1);
      expect(text).not.toContain('body type');
    });

    it('sorts equipment so the text is stable', () => {
      // The same vehicle must produce the same text on every run, or its
      // vector moves for no reason.
      const a = buildSearchText({ ...full, specs: { sunroof: true, alloy_wheels: true } });
      const b = buildSearchText({ ...full, specs: { alloy_wheels: true, sunroof: true } });

      expect(a).toBe(b);
    });
  });

  // The join is .filter(Boolean).join(' '), so an empty-string optional is
  // dropped rather than emitting a double space — which would change the
  // embedded text for a listing that differs only by a blank field.
  it('never emits a double space when an optional is empty', () => {
    expect(buildSearchText({ ...full, description: '' })).not.toMatch(/ {2}/);
    expect(buildSearchText({ ...full, locationCity: '' })).not.toMatch(/ {2}/);
  });

  it('is deterministic for equal input', () => {
    expect(buildSearchText(full)).toBe(buildSearchText({ ...full }));
  });
});
