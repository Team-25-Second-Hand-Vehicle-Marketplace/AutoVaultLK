import { rowsToVocabulary } from './vehicle-dictionary.repository';

describe('rowsToVocabulary', () => {
  it('nests models under their parent make canonical', () => {
    const vocab = rowsToVocabulary([
      {
        dictionary_type: 'MAKE',
        canonical_value: 'Toyota',
        aliases: ['toyata'],
        vehicle_types: ['CAR', 'SUV'],
        parent_canonical: null,
      },
      {
        dictionary_type: 'MODEL',
        canonical_value: 'Corolla',
        aliases: '["corrola"]',
        vehicle_types: ['CAR'],
        parent_canonical: 'Toyota',
      },
      {
        dictionary_type: 'BODY_TYPE',
        canonical_value: 'SEDAN',
        aliases: ['saloon'],
        vehicle_types: [],
        parent_canonical: null,
      },
    ]);

    expect(vocab.makes).toEqual([
      {
        canonical: 'Toyota',
        aliases: ['toyata'],
        vehicleTypes: ['CAR', 'SUV'],
        parentCanonical: undefined,
      },
    ]);
    expect(vocab.models[0]).toMatchObject({
      canonical: 'Corolla',
      aliases: ['corrola'],
      parentCanonical: 'Toyota',
    });
    expect(vocab.bodyTypes[0].canonical).toBe('SEDAN');
  });
});
