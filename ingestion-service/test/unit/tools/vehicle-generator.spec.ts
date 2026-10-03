import {
  KNOWN_COLUMNS,
  REQUIRED_COLUMNS,
  TEMPLATE_HEADER,
} from '../../../src/workers/etl-worker/pipeline/parse/csv-contract';
import {
  convertToCsv,
  convertToJson,
  generateVehicle,
  type GenerationMode,
} from '../../../src/tools/vehicle-generator/vehicle-generator';

/**
 * The synthetic data generator, the downloadable bulk-upload template and the
 * parser's contract are one list of columns. If the generator emitted fewer,
 * test fixtures would stop exercising the columns dealers actually send; if it
 * emitted different ones, they would not be valid uploads.
 */
describe('vehicle generator vs. the dealer CSV template', () => {
  const clean = Array.from({ length: 50 }, (_, i) => generateVehicle(i + 1, 'clean'));
  const csv = convertToCsv(clean);
  const [headerLine, ...rows] = csv.trim().split('\n');

  it('writes exactly the template header, in the template order', () => {
    expect(headerLine.split(',')).toEqual([...TEMPLATE_HEADER]);
    expect(TEMPLATE_HEADER).toHaveLength(43);
    expect(TEMPLATE_HEADER).toEqual([...KNOWN_COLUMNS]);
  });

  it('writes a full-width row for every vehicle', () => {
    expect(rows).toHaveLength(50);
    for (const row of rows) {
      // No generated value contains a comma, so a plain split is exact.
      expect(row.split(',')).toHaveLength(TEMPLATE_HEADER.length);
    }
  });

  it('fills every required column on every clean row', () => {
    for (const vehicle of clean) {
      for (const column of REQUIRED_COLUMNS) {
        expect(String(vehicle[column as keyof typeof vehicle] ?? '')).not.toBe('');
      }
    }
  });

  it('never registers a vehicle before it was built', () => {
    for (const vehicle of clean) {
      expect(Number(vehicle.registration_year)).toBeGreaterThanOrEqual(Number(vehicle.year));
    }
  });

  it.each<GenerationMode>(['clean', 'dirty', 'invalid', 'mixed'])(
    'emits all 43 columns in %s mode',
    (mode) => {
      const vehicle = generateVehicle(1, mode);
      expect(Object.keys(vehicle).sort()).toEqual([...TEMPLATE_HEADER].sort());
    },
  );
});

describe('vehicle generator JSON output', () => {
  const clean = Array.from({ length: 20 }, (_, i) => generateVehicle(i + 1, 'clean'));
  const records: Record<string, unknown>[] = JSON.parse(convertToJson(clean));

  it('writes one flat object per vehicle, using only template columns', () => {
    expect(records).toHaveLength(20);
    for (const record of records) {
      for (const [key, value] of Object.entries(record)) {
        expect(TEMPLATE_HEADER).toContain(key);
        expect(['string', 'number', 'boolean']).toContain(typeof value);
      }
    }
  });

  it('carries every required column on every clean vehicle', () => {
    for (const record of records) {
      for (const column of REQUIRED_COLUMNS) expect(record).toHaveProperty(column);
    }
  });

  it('writes numbers as numbers and flags as booleans, and omits blanks', () => {
    const [first] = records;
    expect(typeof first.year).toBe('number');
    expect(typeof first.price).toBe('number');
    expect(typeof first.is_negotiable).toBe('boolean');
    expect(Object.values(first)).not.toContain('');
  });
});
