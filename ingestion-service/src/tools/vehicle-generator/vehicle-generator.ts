//clean — current valid data
//dirty — realistic messy values that your ETL should normalize
//invalid — deliberately invalid records that validation should reject
//mixed — mostly valid data with some dirty/invalid records
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

type Vehicle = {
  registration_number: string;
  make: string;
  model: string;
  year: number | string;
  price: number | string;
  mileage: number | string;
  fuel_type: string;
  transmission: string;
  body_type: string;
};

type GenerationMode = 'clean' | 'dirty' | 'invalid' | 'mixed';

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

  return {
    registration_number: generateRegistration(index),
    make: manufacturer.make,
    model: randomItem(manufacturer.models),
    year: randomNumber(2015, 2026),
    price: randomNumber(3500000, 25000000),
    mileage: randomNumber(5000, 180000),
    fuel_type: randomItem(FUEL_TYPES),
    transmission: randomItem(TRANSMISSIONS),
    body_type: randomItem(BODY_TYPES),
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

function generateVehicle(
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

function convertToCsv(vehicles: Vehicle[]): string {
  const headers = [
    'registration_number',
    'make',
    'model',
    'year',
    'price',
    'mileage',
    'fuel_type',
    'transmission',
    'body_type',
  ];

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

main().catch((error) => {
  console.error(
    'Vehicle generation failed:',
    error.message,
  );

  process.exit(1);
});