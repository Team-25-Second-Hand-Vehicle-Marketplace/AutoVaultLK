/**
 * Every photo the design asks for, in one place.
 *
 * Each slot is a file at `public/images/<slot>.jpg`. Until that file exists the
 * slot shows a labelled placeholder (see SlotImage), so the layout is complete
 * and you can see exactly what to shoot or source. Drop in a JPG with the same
 * name and it replaces the placeholder - no code change.
 *
 * Brief for all of them: real, natural-looking photos are fine - the layout
 * does not assume a studio shot, a white background or a 3D render.
 */
export interface ImageSlot {
  /** Recommended pixel size (width × height). Larger is fine; keep the ratio. */
  width: number
  height: number
  /** What to look for. */
  brief: string
}

export const IMAGE_SLOTS = {
  'hero-1': {
    width: 2400,
    height: 1350,
    brief: 'Dark, moody hero. A car at dusk or in a garage/showroom, low-key lighting, space on the left for text.',
  },
  'hero-2': {
    width: 2400,
    height: 1350,
    brief: 'Second hero. A vehicle on an open road or coastal road at golden hour, wide shot, space on the left.',
  },
  'hero-3': {
    width: 2400,
    height: 1350,
    brief: 'Third hero. Close, dramatic detail: headlight, wheel or grille, dark background.',
  },
  'cat-car': { width: 1200, height: 900, brief: 'A sedan or hatchback, three-quarter view.' },
  'cat-suv': { width: 1200, height: 900, brief: 'An SUV or crossover, three-quarter view.' },
  'cat-bike': { width: 1200, height: 900, brief: 'A motorcycle, side or three-quarter view.' },
  'cat-van': { width: 1200, height: 900, brief: 'A van or minibus.' },
  'cat-three-wheeler': { width: 1200, height: 900, brief: 'A three-wheeler (tuk-tuk).' },
  'cat-pickup': { width: 1200, height: 900, brief: 'A pickup / double cab.' },
  'cat-lorry': { width: 1200, height: 900, brief: 'A lorry or truck.' },
  'cat-other': { width: 1200, height: 900, brief: 'Any other vehicle: bus, tractor or machinery.' },
  'story-search': {
    width: 1600,
    height: 1200,
    brief: 'Scroll story, step 1 (search). A person browsing on a phone with a car in the background, or a car dashboard screen.',
  },
  'story-verified': {
    width: 1600,
    height: 1200,
    brief: 'Scroll story, step 2 (verified dealers). A dealership forecourt or a handshake over a car key.',
  },
  'story-drive': {
    width: 1600,
    height: 1200,
    brief: 'Scroll story, step 3 (drive away). Someone getting into a car, or a car leaving at sunset.',
  },
  'auth-dealer': {
    width: 1400,
    height: 1800,
    brief: 'Dealer sign-in side panel (tall portrait). A dealership at dusk or a row of cars in warm light, dark towards the bottom where the text sits.',
  },
  'cta-dealer': {
    width: 2000,
    height: 1000,
    brief: 'Dealer call-to-action. A row of cars on a forecourt, wide, dark or dusk lighting.',
  },
} as const satisfies Record<string, ImageSlot>

export type ImageSlotId = keyof typeof IMAGE_SLOTS

/** Category → slot, for the landing page's category tiles. */
export const CATEGORY_SLOT: Record<string, ImageSlotId> = {
  CAR: 'cat-car',
  SUV: 'cat-suv',
  BIKE: 'cat-bike',
  VAN: 'cat-van',
  THREE_WHEELER: 'cat-three-wheeler',
  PICKUP: 'cat-pickup',
  LORRY: 'cat-lorry',
  TRUCK: 'cat-lorry',
}
