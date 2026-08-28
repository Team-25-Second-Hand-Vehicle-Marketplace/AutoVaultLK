import 'reflect-metadata';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

config({ path: '../.env' });


type MakeSeed = {
  name: string;
  types: string[];
  aliases?: string[];
  models: { name: string; type: string; aliases?: string[] }[];
};

const MAKES: MakeSeed[] = [
  {
    name: 'Toyota',
    types: ['CAR', 'SUV', 'VAN', 'PICKUP', 'LORRY'],
    aliases: ['toyata', 'toyota', 'toyta'],
    models: [
      { name: 'Vitz', type: 'CAR', aliases: ['vits'] },
      { name: 'Aqua', type: 'CAR' },
      { name: 'Axio', type: 'CAR' },
      { name: 'Corolla', type: 'CAR', aliases: ['corrola', 'carola'] },
      { name: 'Premio', type: 'CAR' },
      { name: 'Allion', type: 'CAR' },
      { name: 'Prius', type: 'CAR' },
      { name: 'Belta', type: 'CAR' },
      { name: 'Passo', type: 'CAR' },
      { name: 'Yaris', type: 'CAR' },
      { name: 'CHR', type: 'SUV', aliases: ['c-hr', 'chr'] },
      { name: 'RAV4', type: 'SUV', aliases: ['rav 4'] },
      { name: 'Land Cruiser', type: 'SUV', aliases: ['landcruiser', 'land cruser'] },
      { name: 'Prado', type: 'SUV' },
      { name: 'Harrier', type: 'SUV' },
      { name: 'Rush', type: 'SUV' },
      { name: 'HiAce', type: 'VAN', aliases: ['hiace', 'hi-ace'] },
      { name: 'Noah', type: 'VAN' },
      { name: 'Townace', type: 'VAN', aliases: ['town ace'] },
      { name: 'Hilux', type: 'PICKUP', aliases: ['hi-lux'] },
      { name: 'Dyna', type: 'LORRY' },
    ],
  },
  {
    name: 'Suzuki',
    types: ['CAR', 'SUV', 'VAN', 'BIKE'],
    aliases: ['suzeki', 'zuzuki'],
    models: [
      { name: 'Alto', type: 'CAR' },
      { name: 'Wagon R', type: 'CAR', aliases: ['wagonr', 'wagon-r'] },
      { name: 'Swift', type: 'CAR' },
      { name: 'Celerio', type: 'CAR' },
      { name: 'Baleno', type: 'CAR' },
      { name: 'Spacia', type: 'VAN' },
      { name: 'Every', type: 'VAN' },
      { name: 'Vitara', type: 'SUV' },
      { name: 'Jimny', type: 'SUV' },
      { name: 'Gixxer', type: 'BIKE' },
    ],
  },
  {
    name: 'Honda',
    types: ['CAR', 'SUV', 'VAN', 'BIKE'],
    aliases: ['hoda'],
    models: [
      { name: 'Fit', type: 'CAR', aliases: ['fit shuttle'] },
      { name: 'Civic', type: 'CAR' },
      { name: 'Vezel', type: 'SUV', aliases: ['vezal'] },
      { name: 'Grace', type: 'CAR' },
      { name: 'Insight', type: 'CAR' },
      { name: 'CR-V', type: 'SUV', aliases: ['crv'] },
      { name: 'Freed', type: 'VAN' },
      { name: 'Dio', type: 'BIKE' },
      { name: 'CB Hornet', type: 'BIKE' },
    ],
  },
  {
    name: 'Nissan',
    types: ['CAR', 'SUV', 'VAN', 'PICKUP'],
    aliases: ['nisan', 'nissen'],
    models: [
      { name: 'March', type: 'CAR' },
      { name: 'Leaf', type: 'CAR' },
      { name: 'Sunny', type: 'CAR' },
      { name: 'Bluebird', type: 'CAR' },
      { name: 'X-Trail', type: 'SUV', aliases: ['xtrail'] },
      { name: 'Juke', type: 'SUV' },
      { name: 'Caravan', type: 'VAN' },
      { name: 'Navara', type: 'PICKUP' },
    ],
  },
  {
    name: 'Mitsubishi',
    types: ['CAR', 'SUV', 'VAN', 'PICKUP', 'LORRY'],
    aliases: ['mitsubhishi', 'mitsibishi', 'mitsu'],
    models: [
      { name: 'Lancer', type: 'CAR' },
      { name: 'Montero', type: 'SUV' },
      { name: 'Outlander', type: 'SUV' },
      { name: 'Pajero', type: 'SUV' },
      { name: 'L200', type: 'PICKUP' },
      { name: 'Delica', type: 'VAN' },
      { name: 'Canter', type: 'LORRY' },
    ],
  },
  {
    name: 'Hyundai',
    types: ['CAR', 'SUV', 'VAN'],
    aliases: ['hundai', 'hyandai'],
    models: [
      { name: 'Accent', type: 'CAR' },
      { name: 'Elantra', type: 'CAR' },
      { name: 'i10', type: 'CAR' },
      { name: 'i20', type: 'CAR' },
      { name: 'Tucson', type: 'SUV' },
      { name: 'Santa Fe', type: 'SUV', aliases: ['santafe'] },
      { name: 'Creta', type: 'SUV' },
    ],
  },
  {
    name: 'Micro',
    types: ['CAR', 'SUV', 'VAN'],
    models: [
      { name: 'Panda', type: 'CAR' },
      { name: 'Trend', type: 'CAR' },
      { name: 'Emgrand', type: 'CAR' },
      { name: 'MPV', type: 'VAN' },
    ],
  },
  {
    name: 'Perodua',
    types: ['CAR'],
    aliases: ['perodua', 'produa'],
    models: [
      { name: 'Viva', type: 'CAR' },
      { name: 'Axia', type: 'CAR' },
      { name: 'Bezza', type: 'CAR' },
],
  },
  {
    name: 'Daihatsu',
    types: ['CAR', 'VAN'],
    models: [
      { name: 'Mira', type: 'CAR' },
      { name: 'Move', type: 'CAR' },
      { name: 'Terios', type: 'SUV' },
      { name: 'Hijet', type: 'VAN' },
    ],
  },
  {
    name: 'Mahindra',
    types: ['SUV', 'PICKUP', 'TRACTOR', 'THREE_WHEELER'],
    aliases: ['mahendra'],
    models: [
      { name: 'Scorpio', type: 'SUV' },
      { name: 'Bolero', type: 'PICKUP' },
      { name: 'Thar', type: 'SUV' },
      { name: 'XUV500', type: 'SUV' },
      { name: 'Alfa', type: 'THREE_WHEELER' },
    ],
  },
  {
    name: 'Tata',
    types: ['CAR', 'SUV', 'LORRY', 'BUS', 'THREE_WHEELER', 'PICKUP'],
    models: [
      { name: 'Nano', type: 'CAR' },
      { name: 'Indica', type: 'CAR' },
      { name: 'Ace', type: 'LORRY' },
      { name: 'Dimo Batta', type: 'THREE_WHEELER', aliases: ['dimo'] },
      { name: 'Xenon', type: 'PICKUP' },
    ],
  },
  {
    name: 'Kia',
    types: ['CAR', 'SUV', 'VAN'],
    models: [
      { name: 'Picanto', type: 'CAR' },
      { name: 'Sportage', type: 'SUV' },
      { name: 'Sorento', type: 'SUV' },
    ],
  },
  {
    name: 'Mazda',
    types: ['CAR', 'SUV', 'PICKUP'],
    models: [
      { name: 'Demio', type: 'CAR' },
      { name: 'Axela', type: 'CAR' },
      { name: 'CX-5', type: 'SUV', aliases: ['cx5'] },
      { name: 'BT-50', type: 'PICKUP' },
    ],
  },
  {
    name: 'BMW',
    types: ['CAR', 'SUV', 'BIKE'],
    models: [
      { name: '320i', type: 'CAR' },
      { name: '520d', type: 'CAR' },
      { name: 'X1', type: 'SUV' },
      { name: 'X5', type: 'SUV' },
    ],
  },
  {
    name: 'Mercedes-Benz',
    types: ['CAR', 'SUV', 'VAN', 'LORRY'],
    aliases: ['benz', 'mercedes', 'merc'],
    models: [
      { name: 'C200', type: 'CAR' },
      { name: 'E250', type: 'CAR' },
      { name: 'GLA', type: 'SUV' },
      { name: 'Sprinter', type: 'VAN' },
    ],
  },
  {
    name: 'Audi',
    types: ['CAR', 'SUV'],
    models: [
      { name: 'A4', type: 'CAR' },
      { name: 'A6', type: 'CAR' },
      { name: 'Q5', type: 'SUV' },
    ],
  },
  {
    name: 'Land Rover',
    types: ['SUV'],
    aliases: ['landrover', 'range rover', 'rangerover'],
    models: [
      { name: 'Defender', type: 'SUV' },
      { name: 'Discovery', type: 'SUV' },
      { name: 'Range Rover Evoque', type: 'SUV', aliases: ['evoque'] },
    ],
  },
  {
    name: 'Isuzu',
    types: ['LORRY', 'TRUCK', 'BUS', 'PICKUP'],
    models: [
      { name: 'Elf', type: 'LORRY' },
      { name: 'Forward', type: 'TRUCK' },
      { name: 'D-Max', type: 'PICKUP', aliases: ['dmax'] },
    ],
  },
  {
    name: 'Ashok Leyland',
    types: ['BUS', 'LORRY', 'TRUCK'],
    aliases: ['ashok leylend', 'leyland'],
    models: [
      { name: 'Viking', type: 'BUS' },
      { name: 'Dost', type: 'LORRY' },
    ],
  },
  {
    name: 'Bajaj',
    types: ['BIKE', 'THREE_WHEELER'],
    aliases: ['bajaaj', 'bajay'],
    models: [
      { name: 'RE', type: 'THREE_WHEELER', aliases: ['bajaj re', 'four stroke'] },
      { name: 'Pulsar', type: 'BIKE', aliases: ['pulser'] },
      { name: 'Discover', type: 'BIKE' },
      { name: 'CT100', type: 'BIKE' },
      { name: 'Platina', type: 'BIKE' },
    ],
  },
  {
    name: 'TVS',
    types: ['BIKE', 'THREE_WHEELER'],
    models: [
      { name: 'Apache', type: 'BIKE' },
      { name: 'Ntorq', type: 'BIKE' },
      { name: 'Wego', type: 'BIKE' },
      { name: 'King', type: 'THREE_WHEELER' },
    ],
  },
  {
    name: 'Hero',
    types: ['BIKE'],
    models: [
      { name: 'Splendor', type: 'BIKE' },
      { name: 'Passion', type: 'BIKE' },
      { name: 'Dash', type: 'BIKE' },
    ],
  },
  {
    name: 'Yamaha',
    types: ['BIKE'],
    models: [
      { name: 'FZ', type: 'BIKE' },
      { name: 'Ray ZR', type: 'BIKE' },
      { name: 'MT-15', type: 'BIKE', aliases: ['mt15'] },
      { name: 'R15', type: 'BIKE' },
    ],
  },
  {
    name: 'KTM',
    types: ['BIKE'],
    models: [
      { name: 'Duke 200', type: 'BIKE', aliases: ['duke'] },
      { name: 'RC 200', type: 'BIKE' },
    ],
  },
  {
    name: 'Demak',
    types: ['BIKE'],
    models: [{ name: 'DTM', type: 'BIKE' }],
  },
  {
    name: 'Piaggio',
    types: ['THREE_WHEELER', 'BIKE'],
    models: [{ name: 'Ape', type: 'THREE_WHEELER' }],
  },
  {
    name: 'Foton',
    types: ['LORRY', 'VAN', 'PICKUP'],
    models: [{ name: 'Aumark', type: 'LORRY' }],
  },
  {
    name: 'John Deere',
    types: ['TRACTOR'],
    models: [{ name: '5045D', type: 'TRACTOR' }],
  },
  {
    name: 'Kubota',
    types: ['TRACTOR', 'HEAVY_MACHINERY'],
    models: [{ name: 'L3408', type: 'TRACTOR' }],
  },
  {
    name: 'JCB',
    types: ['HEAVY_MACHINERY'],
    models: [{ name: '3DX', type: 'HEAVY_MACHINERY' }],
  },
];

/**
 * Body types are a flat dictionary — no parent, no type scoping. "jeep" is
 * an alias for SUV here rather than a vehicle_type value, because locally it
 * describes a body style, not a category buyers filter on separately.
 */
const BODY_TYPES: { name: string; aliases?: string[] }[] = [
  { name: 'SEDAN', aliases: ['saloon'] },
  { name: 'HATCHBACK', aliases: ['hatch'] },
  { name: 'SUV', aliases: ['jeep'] },
  { name: 'WAGON', aliases: ['estate', 'station wagon'] },
  { name: 'COUPE' },
  { name: 'CONVERTIBLE' },
  { name: 'PICKUP', aliases: ['cab', 'double cab', 'single cab'] },
  { name: 'MINIVAN', aliases: ['mpv'] },
  { name: 'SCOOTER', aliases: ['scooty'] },
  { name: 'MOTORBIKE', aliases: ['motorcycle'] },
];

async function seed() {
  const ds = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL,
    entities: [],
    synchronize: false,
    // Opt-in TLS so this can seed RDS (which forces SSL) as well as local
    // Docker Postgres (which serves no certificate).
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  await ds.initialize();
  console.log('Connected. Seeding vehicle_dictionaries…');

  let makeCount = 0;
  let modelCount = 0;

  for (const make of MAKES) {
    // RETURNING gives nothing on a conflict, so re-select to get the id on
    // a re-run. Needed either way — models require the parent id.
    await ds.query(
      `INSERT INTO marketplace.vehicle_dictionaries
         (dictionary_type, parent_id, canonical_value, aliases, vehicle_types)
       VALUES ('MAKE', NULL, $1, $2::jsonb, $3::text[])
       ON CONFLICT (dictionary_type, parent_id, canonical_value) DO NOTHING`,
      [make.name, JSON.stringify(make.aliases ?? []), make.types],
    );

    const [row] = await ds.query(
      `SELECT id FROM marketplace.vehicle_dictionaries
       WHERE dictionary_type='MAKE' AND parent_id IS NULL AND canonical_value=$1`,
      [make.name],
    );
    makeCount++;

    for (const model of make.models) {
      await ds.query(
        `INSERT INTO marketplace.vehicle_dictionaries
           (dictionary_type, parent_id, canonical_value, aliases, vehicle_types)
         VALUES ('MODEL', $1, $2, $3::jsonb, $4::text[])
         ON CONFLICT (dictionary_type, parent_id, canonical_value) DO NOTHING`,
        [row.id, model.name, JSON.stringify(model.aliases ?? []), [model.type]],
      );
      modelCount++;
    }
  }

  
  for (const body of BODY_TYPES) {
    await ds.query(
      `INSERT INTO marketplace.vehicle_dictionaries
         (dictionary_type, parent_id, canonical_value, aliases, vehicle_types)
       VALUES ('BODY_TYPE', NULL, $1, $2::jsonb, '{}'::text[])
       ON CONFLICT (dictionary_type, parent_id, canonical_value) DO NOTHING`,
      [body.name, JSON.stringify(body.aliases ?? [])],
    );
  }

  console.log(
    `Seeded ${makeCount} makes, ${modelCount} models, ${BODY_TYPES.length} body types.`,
  );
  await ds.destroy();
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});

