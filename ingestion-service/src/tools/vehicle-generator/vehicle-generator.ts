//clean — current valid data
//dirty — realistic messy values that your ETL should normalize
//invalid — deliberately invalid records that validation should reject
//mixed — mostly valid data with some dirty/invalid records
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { TEMPLATE_HEADER } from '../../workers/etl-worker/pipeline/parse/csv-contract';

/**
 * One row of the dealer CSV — every column of `TEMPLATE_HEADER`, in the same
 * names the parser reads, so a generated file is a valid upload by
 * construction and carries the same 43 columns the downloadable template does.
 *
 * Category-gated columns (bike, van/bus, truck) are blank on the cars this
 * generator produces: the enrich stage ignores them for any other
 * vehicle_type, and blank is exactly what a dealer's file would hold.
 */
export type Vehicle = {
  registration_number: string;
  make: string;
  model: string;
  year: number | string;
  price: number | string;
  mileage: number | string;
  fuel_type: string;
  transmission: string;
  body_type: string;
  // Widened from optional to required in csv-contract.ts (SRS Appendix A) —
  // a fixture missing any of these fails validateFile's file-gate check
  // rather than reaching the row-level dirty/invalid cases these fixtures
  // exist to exercise.
  color: string;
  engine_capacity_cc: number | string;
  owners_count: number | string;
  location_district: string;

  vehicle_type: string;
  condition: string;
  location_city: string;
  chassis_number: string;
  description: string;
  is_negotiable: string;
  registration_year: number | string;
  seats: number | string;
  doors: number | string;
  airbags: number | string;
  load_capacity_kg: number | string;
  drive_type: string;
  sunroof: string;
  full_option: string;
  alloy_wheels: string;
  reverse_camera: string;
  leather_seats: string;
  power_steering: string;
  air_conditioning: string;
  stroke_type: string;
  cooling_system: string;
  start_type: string;
  abs_equipped: string;
  seating_capacity: number | string;
  roof_type: string;
  wheelbase: string;
  door_configuration: string;
  payload_capacity_kg: number | string;
  axle_count: number | string;
  cargo_bed_type: string;
};

export type GenerationMode = 'clean' | 'dirty' | 'invalid' | 'mixed';

const MAKES = [
  {
    make: 'Toyota',
    models: ['Corolla', 'Prius', 'Vitz', 'Yaris', 'RAV4'],
  },
  {
    make: 'Honda',
    models: ['Civic', 'Vezel', 'Fit', 'CR-V'],
  },
  {
    make: 'Nissan',
    models: ['Leaf', 'March', 'X-Trail', 'Sunny'],
  },
  {
    make: 'BMW',
    models: ['320i', '520i', 'X1', 'X3'],
  },
  {
    make: 'Mercedes-Benz',
    models: ['C200', 'E200', 'GLA', 'GLC'],
  },
];

const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Electric'];

const TRANSMISSIONS = ['Automatic', 'Manual'];

const BODY_TYPES = [
  'Sedan',
  'SUV',
  'Hatchback',
  'Wagon',
  'Coupe',
];

const COLORS = ['White', 'Silver', 'Black', 'Pearl White', 'Grey', 'Blue', 'Red'];

const DISTRICTS = ['Colombo', 'Gampaha', 'Kandy', 'Galle', 'Kurunegala'];

// A real city inside each district, so location_city agrees with location_district.
const CITIES: Record<string, string[]> = {
  Colombo: ['Nugegoda', 'Dehiwala', 'Maharagama', 'Colombo 07'],
  Gampaha: ['Negombo', 'Kadawatha', 'Ja-Ela'],
  Kandy: ['Peradeniya', 'Katugastota'],
  Galle: ['Unawatuna', 'Hikkaduwa'],
  Kurunegala: ['Kuliyapitiya', 'Narammala'],
};

const DRIVE_TYPES = ['FWD', 'RWD', 'AWD', '4WD'];
const CHASSIS_PREFIXES = ['NZE', 'ZVW', 'GK', 'DBA', 'ZE'];

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRegistration(index: number): string {
  return `WP-${String(index).padStart(4, '0')}`;
}

/**
 * Generate a completely valid vehicle.
 */
function generateCleanVehicle(index: number): Vehicle {
  const manufacturer = randomItem(MAKES);
  const bodyType = randomItem(BODY_TYPES);
  const district = randomItem(DISTRICTS);
  const year = randomNumber(2015, 2026);
  const mileage = randomNumber(5000, 180000);
  const isSuv = bodyType === 'SUV';
  const flag = () => (Math.random() < 0.5 ? 'true' : 'false');

  return {
    registration_number: generateRegistration(index),
    make: manufacturer.make,
    model: randomItem(manufacturer.models),
    year,
    price: randomNumber(3500000, 25000000),
    mileage,
    fuel_type: randomItem(FUEL_TYPES),
    transmission: randomItem(TRANSMISSIONS),
    body_type: bodyType,
    color: randomItem(COLORS),
    engine_capacity_cc: randomNumber(1000, 3000),
    owners_count: randomNumber(1, 4),
    location_district: district,

    vehicle_type: isSuv ? 'SUV' : 'Car',
    // New only makes sense for a barely driven vehicle.
    condition:
      mileage < 10000 ? 'New' : Math.random() < 0.2 ? 'Reconditioned' : 'Used',
    location_city: randomItem(CITIES[district]),
    chassis_number: `${randomItem(CHASSIS_PREFIXES)}${randomNumber(10, 99)}-${String(
      randomNumber(0, 9999999),
    ).padStart(7, '0')}`,
    description: `${year} ${manufacturer.make} well maintained with full service history.`,
    is_negotiable: flag(),
    // Never earlier than the manufacture year.
    registration_year: Math.min(year + randomNumber(0, 1), new Date().getFullYear()),
    seats: isSuv ? randomItem([5, 7]) : 5,
    doors: isSuv ? 5 : randomItem([4, 5]),
    airbags: randomNumber(2, 8),
    load_capacity_kg: '',
    drive_type: randomItem(DRIVE_TYPES),
    sunroof: flag(),
    full_option: flag(),
    alloy_wheels: flag(),
    reverse_camera: flag(),
    leather_seats: flag(),
    power_steering: 'true',
    air_conditioning: 'true',
    stroke_type: '',
    cooling_system: '',
    start_type: '',
    abs_equipped: '',
    seating_capacity: '',
    roof_type: '',
    wheelbase: '',
    door_configuration: '',
    payload_capacity_kg: '',
    axle_count: '',
    cargo_bed_type: '',
  };
}

/**
 * Dirty data is still potentially valid, but contains
 * formatting inconsistencies that the ETL should normalize.
 */
function makeDirty(vehicle: Vehicle): Vehicle {
  const dirtyTypes = [
    'whitespace',
    'case',
    'price-format',
    'mileage-format',
    'fuel-format',
    'transmission-format',
  ];

  const dirtyType = randomItem(dirtyTypes);

  switch (dirtyType) {
    case 'whitespace':
      return {
        ...vehicle,
        make: `  ${vehicle.make} `,
        model: ` ${vehicle.model} `,
      };

    case 'case':
      return {
        ...vehicle,
        fuel_type: vehicle.fuel_type.toUpperCase(),
        transmission: vehicle.transmission.toLowerCase(),
      };

    case 'price-format':
      return {
        ...vehicle,
        price: `Rs ${vehicle.price.toLocaleString()}`,
      };

    case 'mileage-format':
      return {
        ...vehicle,
        mileage: `${vehicle.mileage.toLocaleString()} km`,
      };

    case 'fuel-format':
      return {
        ...vehicle,
        fuel_type:
          vehicle.fuel_type === 'Petrol'
            ? 'petrol'
            : vehicle.fuel_type === 'Diesel'
              ? ' DIESEL '
              : vehicle.fuel_type,
      };

    case 'transmission-format':
      return {
        ...vehicle,
        transmission:
          vehicle.transmission === 'Automatic'
            ? 'auto'
            : 'manual',
      };

    default:
      return vehicle;
  }
}

/**
 * Invalid data intentionally violates expected validation rules.
 */
function makeInvalid(vehicle: Vehicle, index: number): Vehicle {
  const invalidTypes = [
    'missing-make',
    'missing-model',
    'invalid-year',
    'negative-price',
    'negative-mileage',
    'invalid-fuel',
    'invalid-transmission',
  ];

  const invalidType = randomItem(invalidTypes);

  switch (invalidType) {
    case 'missing-make':
      return {
        ...vehicle,
        make: '',
      };

    case 'missing-model':
      return {
        ...vehicle,
        model: '',
      };

    case 'invalid-year':
      return {
        ...vehicle,
        year: 'ABCD',
      };

    case 'negative-price':
      return {
        ...vehicle,
        price: -500000,
      };

    case 'negative-mileage':
      return {
        ...vehicle,
        mileage: -100,
      };

    case 'invalid-fuel':
      return {
        ...vehicle,
        fuel_type: 'UnknownFuel',
      };

    case 'invalid-transmission':
      return {
        ...vehicle,
        transmission: 'UnknownTransmission',
      };

    default:
      return {
        ...vehicle,
        registration_number: `INVALID-${index}`,
      };
  }
}

export function generateVehicle(
  index: number,
  mode: GenerationMode,
): Vehicle {
  const cleanVehicle = generateCleanVehicle(index);

  switch (mode) {
    case 'clean':
      return cleanVehicle;

    case 'dirty':
      return makeDirty(cleanVehicle);

    case 'invalid':
      return makeInvalid(cleanVehicle, index);

    case 'mixed': {
      const random = Math.random();

      if (random < 0.15) {
        return makeInvalid(cleanVehicle, index);
      }

      if (random < 0.35) {
        return makeDirty(cleanVehicle);
      }

      return cleanVehicle;
    }
  }
}

function parseArguments() {
  const args = process.argv.slice(2);

  let count = 10;
  let format: 'csv' | 'json' = 'csv';
  let mode: GenerationMode = 'clean';
  let output: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':
        count = Number(args[++i]);
        break;

      case '--format':
        format = args[++i] as 'csv' | 'json';
        break;

      case '--mode':
        mode = args[++i] as GenerationMode;
        break;

      case '--output':
        output = args[++i];
        break;
    }
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--count must be a positive integer');
  }

  if (!['csv', 'json'].includes(format)) {
    throw new Error('--format must be csv or json');
  }

  if (!['clean', 'dirty', 'invalid', 'mixed'].includes(mode)) {
    throw new Error(
      '--mode must be clean, dirty, invalid, or mixed',
    );
  }

  return {
    count,
    format,
    mode,
    output,
  };
}

function escapeCsv(value: string | number): string {
  const stringValue = String(value);

  if (
    stringValue.includes(',') ||
    stringValue.includes('"') ||
    stringValue.includes('\n')
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

export function convertToCsv(vehicles: Vehicle[]): string {
  // The one definition of the dealer CSV's columns — the same list the
  // downloadable template and the parser use — so this generator cannot drift
  // from them.
  const headers = [...TEMPLATE_HEADER];

  const rows = vehicles.map((vehicle) =>
    headers
      .map((header) =>
        escapeCsv(vehicle[header as keyof Vehicle]),
      )
      .join(','),
  );

  return [headers.join(','), ...rows].join('\n') + '\n';
}

async function main() {
  const { count, format, mode, output } = parseArguments();

  const vehicles = Array.from(
    { length: count },
    (_, index) =>
      generateVehicle(index + 1, mode),
  );

  const outputDirectory = join(
    process.cwd(),
    'test-data',
  );

  await mkdir(outputDirectory, {
    recursive: true,
  });

  const defaultFileName =
    `vehicles-${mode}-${count}.${format}`;

  const outputPath = output
    ? join(process.cwd(), output)
    : join(outputDirectory, defaultFileName);

  const content =
    format === 'csv'
      ? convertToCsv(vehicles)
      : JSON.stringify(vehicles, null, 2);

  await writeFile(outputPath, content, 'utf8');

  console.log(`Generated ${count} vehicles.`);
  console.log(`Mode: ${mode}`);
  console.log(`Format: ${format.toUpperCase()}`);
  console.log(`Output: ${outputPath}`);
}

// Guarded so ingestion-tester.ts can import generateVehicle/convertToCsv
// without also triggering this file's own CLI run as a side effect of import.
if (require.main === module) {
  main().catch((error) => {
    console.error(
      'Vehicle generation failed:',
      error.message,
    );

    process.exit(1);
  });
}