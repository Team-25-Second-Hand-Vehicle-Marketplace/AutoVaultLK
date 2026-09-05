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
 * ON — the exact field set and ordering — so a change is a deliberate act with
 * a re-embed attached, not an accident. buildSearchText was untested in either
 * service before this.
 */
describe('buildSearchText', () => {
  const full: SearchTextFields = {
    make: 'Toyota',
    model: 'Aqua',
    manufactureYear: 2015,
    vehicleType: 'CAR',
    fuelType: 'HYBRID',
    transmissionType: 'AUTOMATIC',
    locationCity: 'Colombo',
    locationDistrict: 'Colombo',
    specs: { body_type: 'Hatchback' },
    description: 'Well maintained',
  };

  it('joins every field in a fixed order', () => {
    expect(buildSearchText(full)).toBe(
      'Toyota Aqua 2015 CAR HYBRID AUTOMATIC Colombo Colombo Hatchback Well maintained',
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
        manufactureYear: 2018,
        vehicleType: 'SUV',
        fuelType: null,
        transmissionType: undefined,
        locationCity: null,
        locationDistrict: null,
        specs: null,
        description: null,
      }),
    ).toBe('Honda Vezel 2018 SUV');
  });

  it('pulls body_type out of specs but ignores non-string values', () => {
    expect(buildSearchText({ ...full, specs: { body_type: 42 } })).not.toContain('42');
    expect(buildSearchText({ ...full, specs: {} })).not.toContain('Hatchback');
  });

  it('ignores spec keys other than body_type', () => {
    const text = buildSearchText({
      ...full,
      specs: { body_type: 'Sedan', colour: 'Pearl White', seats: 5 },
    });

    expect(text).toContain('Sedan');
    expect(text).not.toContain('Pearl White');
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
