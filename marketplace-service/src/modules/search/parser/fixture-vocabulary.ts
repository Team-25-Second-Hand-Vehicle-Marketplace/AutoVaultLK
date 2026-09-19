import type { DictionaryEntry, ParserVocabulary } from './types';

function make(
  canonical: string,
  aliases: string[],
  vehicleTypes: string[],
  models: DictionaryEntry[],
): { make: DictionaryEntry; models: DictionaryEntry[] } {
  return {
    make: { canonical, aliases, vehicleTypes },
    models: models.map((model) => ({ ...model, parentCanonical: canonical })),
  };
}

const toyota = make(
  'Toyota',
  ['toyata', 'toyta'],
  ['CAR', 'SUV', 'VAN', 'PICKUP', 'LORRY'],
  [
    { canonical: 'Aqua', aliases: [], vehicleTypes: ['CAR'] },
    { canonical: 'Corolla', aliases: ['corrola', 'carola'], vehicleTypes: ['CAR'] },
    {
      canonical: 'Land Cruiser',
      aliases: ['landcruiser', 'land cruser'],
      vehicleTypes: ['SUV'],
    },
    { canonical: 'CHR', aliases: ['c-hr', 'chr'], vehicleTypes: ['SUV'] },
    { canonical: 'RAV4', aliases: ['rav 4'], vehicleTypes: ['SUV'] },
    { canonical: 'HiAce', aliases: ['hiace', 'hi-ace'], vehicleTypes: ['VAN'] },
  ],
);

const honda = make(
  'Honda',
  ['hoda'],
  ['CAR', 'SUV', 'VAN', 'BIKE'],
  [
    { canonical: 'Fit', aliases: ['fit shuttle'], vehicleTypes: ['CAR'] },
    { canonical: 'Civic', aliases: [], vehicleTypes: ['CAR'] },
    { canonical: 'Vezel', aliases: ['vezal'], vehicleTypes: ['SUV'] },
  ],
);

const suzuki = make(
  'Suzuki',
  ['suzeki', 'zuzuki'],
  ['CAR', 'SUV', 'VAN', 'BIKE'],
  [
    { canonical: 'Alto', aliases: [], vehicleTypes: ['CAR'] },
    { canonical: 'Wagon R', aliases: ['wagonr', 'wagon-r'], vehicleTypes: ['CAR'] },
  ],
);

const mercedes = make(
  'Mercedes-Benz',
  ['benz', 'mercedes', 'merc'],
  ['CAR', 'SUV', 'VAN', 'LORRY'],
  [{ canonical: 'C200', aliases: [], vehicleTypes: ['CAR'] }],
);

const nissan = make(
  'Nissan',
  ['nisan', 'nissen'],
  ['CAR', 'SUV', 'VAN', 'PICKUP'],
  [{ canonical: 'X-Trail', aliases: ['xtrail'], vehicleTypes: ['SUV'] }],
);

export const FIXTURE_VOCABULARY: ParserVocabulary = {
  makes: [toyota, honda, suzuki, mercedes, nissan].map((row) => row.make),
  models: [toyota, honda, suzuki, mercedes, nissan].flatMap((row) => row.models),
  bodyTypes: [
    { canonical: 'SEDAN', aliases: ['saloon'], vehicleTypes: [] },
    { canonical: 'HATCHBACK', aliases: ['hatch'], vehicleTypes: [] },
    { canonical: 'WAGON', aliases: ['estate', 'station wagon'], vehicleTypes: [] },
    { canonical: 'COUPE', aliases: [], vehicleTypes: [] },
    { canonical: 'CONVERTIBLE', aliases: [], vehicleTypes: [] },
    { canonical: 'MINIVAN', aliases: ['mpv'], vehicleTypes: [] },
    { canonical: 'SCOOTER', aliases: ['scooty'], vehicleTypes: [] },
    { canonical: 'MOTORBIKE', aliases: ['motorcycle'], vehicleTypes: [] },
  ],
};
