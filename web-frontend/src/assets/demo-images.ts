/**
 * PLACEHOLDER PHOTOGRAPHY — FOR DEMO SNAPSHOTS ONLY.
 *
 * Stock vehicle photos from Unsplash, used so screenshots of the landing and
 * search pages aren't a wall of grey silhouettes. NOT project assets, and
 * with a handful of exceptions NOT pictures of the specific model on the
 * card.
 *
 * How closely these match, and why they can't match perfectly
 * ─────────────────────────────────────────────────────────────────────
 * A few globally-common models resolve to a genuine photo of that model —
 * Corolla, Land Cruiser, Hilux (see MODEL_EXACT). Most of the seeded
 * catalogue cannot: it is largely Japanese-domestic and Indian-market
 * vehicles (Aqua, Axio, Vitz, Premio, Townace, Vezel, Grace, Freed, Micro
 * Panda, Perodua Viva, Bajaj RE, TVS King, Ashok Leyland Dost, Foton
 * Aumark), and free stock libraries have essentially no coverage of them.
 * Searching a model name there mostly returns European luxury cars.
 *
 * So everything else resolves to the closest honest *category* — a compact
 * hybrid hatch, a kei-sized city car, a light box lorry, a backhoe loader.
 * The goal is that every photo is the right KIND of vehicle at the right
 * size, not that it is the right badge. A Vezel card showing a generic
 * compact crossover reads correctly in a screenshot; showing it a sedan or
 * a bus would not.
 *
 * Licensing: the Unsplash License permits free commercial use with no
 * attribution required, and explicitly allows copying, modifying and
 * distributing the images. Its two prohibitions — reselling unmodified
 * images, and compiling Unsplash photos into a competing stock-image
 * service — do not apply to using them as UI content here.
 * https://unsplash.com/license
 *
 * Referenced by URL rather than committed as binaries, deliberately:
 *   - nothing unlicensed enters git history, so removing them later is a
 *     one-file change rather than a history rewrite;
 *   - it keeps the repo small;
 *   - and a broken image at demo time is a visible signal that these are
 *     still placeholders, rather than something that quietly ships.
 *
 * The tradeoff is that they need network access, and Unsplash can REASSIGN
 * an ID to a completely different photo. That failure is silent and far
 * worse than a 404: the ID keeps returning 200 image/jpeg, so nothing here
 * or in CI notices, and the card cheerfully renders the wrong picture. It
 * has already happened four times — one lorry ID became a photo of a pug in
 * a t-shirt, a pickup became abstract liquid, and both three-wheeler IDs
 * became a ping-pong paddle and the Pyramids.
 *
 * So: a 200 is NOT verification. Any ID added or audited here must be
 * OPENED AND LOOKED AT, and re-checked whenever these photos are touched. If you need offline snapshots, download them into
 * public/demo/ and switch the constants to local paths — no call site
 * changes.
 *
 * ─────────────────────────────────────────────────────────────────────
 * TO REMOVE: delete this file, drop the `<img className="hero__bg">` from
 * HomePage, and delete the `demoImageFor` calls in VehicleCard and
 * VehicleDetailPage. All three call sites are marked with a PLACEHOLDER
 * comment.
 * ─────────────────────────────────────────────────────────────────────
 */

const CDN = 'https://images.unsplash.com/'

/** Sized and cropped for the full-bleed hero; the scrim handles contrast. */
export const HERO_IMAGE = `${CDN}photo-1503376780353-7e6692767b70?auto=format&fit=crop&w=1920&q=70`

const LOCAL_EXACT: Record<string, string> = {
  'BUS|tata indica': '/demo/tata-indica.png',
  'BUS|ashok leyland viking': '/demo/ashok-leyland-viking.png',
}

const MODEL_OVERRIDE: Record<string, string> = {
  'PICKUP|mahindra bolero': 'photo-1628464682320-6a9ae020cb2b',
  'TRACTOR|mahindra bolero': 'photo-1628464682320-6a9ae020cb2b',
  'TRACTOR|kubota l3408': 'photo-1519003722824-194d4455a60c',
  'HEAVY_MACHINERY|kubota l3408': 'photo-1519003722824-194d4455a60c',
}

const MODEL_EXACT: Record<string, string> = {
  'toyota corolla': 'photo-1623869675781-80aa31012a5a',
  'toyota land cruiser': 'photo-1554841649-de947c4b954a',
  'toyota prado': 'photo-1554841649-de947c4b954a',
  'toyota hilux': 'photo-1559416523-140ddc3d238c',
  'jcb 3dx': 'photo-1780319233376-e3c0235a0055',
}

const CITY_HATCH = [
  'photo-1780534906959-986703bec0ed',
  'photo-1571607388263-1044f9ea01dd',
  'photo-1493238792000-8113da705763',
]

/** Larger hatch/liftbacks incl. hybrids: Aqua, Prius, Fit, Swift, Wagon R, Demio. */
const FAMILY_HATCH = [
  'photo-1503376780353-7e6692767b70',
  'photo-1571607388263-1044f9ea01dd',
  'photo-1494976388531-d1058494cdd8',
]

/** Mainstream sedans: Axio, Premio, Grace, Sunny, Accent, Lancer, Civic. */
const SEDAN = [
  'photo-1550355291-bbee04a92027',
  'photo-1552519507-da3b142c6e3d',
  'photo-1623869675781-80aa31012a5a',
]

/** Premium sedans: C200, 320i, A4. */
const LUXURY_SEDAN = ['photo-1563720223185-11003d516935', 'photo-1580273916550-e323be2ae537']

/** Battery EVs — currently the Nissan Leaf. */
const ELECTRIC = ['photo-1560958089-b8a1929cea89']

/** Compact crossovers: Vezel, CHR, Vitara, Tucson, Outlander, X-Trail, CR-V. */
const COMPACT_SUV = [
  'photo-1519641471654-76ce0107ad1b',
  'photo-1533473359331-0135ef1b58bf',
  'photo-1606664515524-ed2f786a0bd6',
]

/** Body-on-frame 4x4s: Land Cruiser, Prado, Montero, Discovery, Scorpio, Jimny. */
const RUGGED_SUV = [
  'photo-1554841649-de947c4b954a',
  'photo-1533106418989-88406c7cc8ca',
  'photo-1543465077-db45d34b88a5',
]

/** Passenger minivans: Noah, Freed, Townace, Every. */
const MINIVAN = ['photo-1780534906959-986703bec0ed', 'photo-1617469767053-d3b523a0b982']

/** Commercial vans/minibuses: HiAce, Caravan, Sprinter. */
const COMMERCIAL_VAN = ['photo-1786453074748-748612ef393c', 'photo-1600661653561-629509216228']

/** Step-through scooters: Dio, Ntorq. */
const SCOOTER = ['photo-1554223789-df81106a45ed', 'photo-1571068316344-75bc76f77890']

/** Faired/naked sport bikes: R15, Duke 200, Apache, Gixxer, FZ, Pulsar. */
const SPORT_BIKE = [
  'photo-1609630875171-b1321377ee65',
  'photo-1598209279122-8541213a0387',
  'photo-1568772585407-9361f9bf3a87',
]

/** Basic commuter bikes: CT100, Splendor. */
const COMMUTER_BIKE = ['photo-1558981806-ec527fa84c39', 'photo-1449426468159-d96dbf08f19f']

const THREE_WHEELER: string[] = []

/** Double-cab pickups: Hilux, Navara, D-Max, L200, Bolero. */
const PICKUP = ['photo-1559416523-140ddc3d238c', 'photo-1605893477799-b99e3b8b93fe']

/** Light goods/box lorries: Elf, Canter, Ace, Dost, Aumark. */
const LIGHT_LORRY = ['photo-1519003722824-194d4455a60c']

/** Heavy rigid trucks: Isuzu Forward, Ashok Leyland Viking. */
const HEAVY_TRUCK = ['photo-1601584115197-04ecc0da31d7', 'photo-1592838064575-70ed626d3a0e']

/** Buses and coaches. */
const BUS = ['photo-1544620347-c4fd4a3d5957', 'photo-1570125909232-eb263c188f7e']

const TRACTOR = ['photo-1595702852378-f9c79111413f', 'photo-1630394257979-0104638432aa']

/** Construction plant: backhoe loaders and excavators. */
const CONSTRUCTION = ['photo-1780319233376-e3c0235a0055', 'photo-1580901369227-308f6f40bdeb']

/** Above this price a sedan draws from the luxury pool instead. */
const LUXURY_PRICE_LKR = 17_000_000
/** Below this a hatchback is treated as a city/kei-sized car. */
const CITY_CAR_PRICE_LKR = 5_000_000

const RUGGED_MODELS = new Set([
  'land cruiser',
  'prado',
  'montero',
  'discovery',
  'scorpio',
  'jimny',
])

/** Scooter models, for rows where specs.body_type is missing. */
const SCOOTER_MODELS = new Set(['dio', 'ntorq'])

/** Basic commuter bikes, as opposed to sport bikes. */
const COMMUTER_MODELS = new Set(['ct100', 'splendor'])

/** Vans used commercially rather than as family transport. */
const COMMERCIAL_VAN_MODELS = new Set(['hiace', 'caravan', 'sprinter'])

function hashToIndex(id: string, length: number): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % length
}


export function isContainImage(url: string): boolean {
  return url.startsWith('/demo/')
}

/** The listing fields that influence which photo is chosen. */
export interface DemoImageHints {
  vehicleType?: string
  make?: string
  model?: string
  /** specs.body_type — 'SEDAN' | 'HATCHBACK' | 'SCOOTER' | 'MINIVAN' | … */
  bodyType?: string
  fuelType?: string | null
  price?: number
}

/** Picks the pool whose description best fits the listing. */
function poolFor(hints: DemoImageHints): string[] {
  const { vehicleType, bodyType, fuelType, price } = hints
  const model = hints.model?.toLowerCase().trim() ?? ''

  switch (vehicleType) {
    case 'CAR': {
      if (fuelType === 'ELECTRIC') return ELECTRIC
      if (bodyType === 'SEDAN') {
        return price !== undefined && price >= LUXURY_PRICE_LKR ? LUXURY_SEDAN : SEDAN
      }
      if (price !== undefined && price < CITY_CAR_PRICE_LKR) return CITY_HATCH
      return FAMILY_HATCH
    }

    case 'SUV':
      return RUGGED_MODELS.has(model) ? RUGGED_SUV : COMPACT_SUV

    case 'VAN':
      // body_type is MINIVAN for most; the distinction that matters is
      // whether it's a people-carrier or a commercial box.
      return COMMERCIAL_VAN_MODELS.has(model) ? COMMERCIAL_VAN : MINIVAN

    case 'BIKE':
      if (bodyType === 'SCOOTER' || SCOOTER_MODELS.has(model)) return SCOOTER
      return COMMUTER_MODELS.has(model) ? COMMUTER_BIKE : SPORT_BIKE

    case 'THREE_WHEELER':
      return THREE_WHEELER
    case 'PICKUP':
      return PICKUP
    case 'LORRY':
      return LIGHT_LORRY
    case 'TRUCK':
      return HEAVY_TRUCK
    case 'BUS':
      return BUS
    case 'TRACTOR':
      return TRACTOR
    case 'HEAVY_MACHINERY':
      return CONSTRUCTION
    default:
      return FAMILY_HATCH
  }
}

export function demoImageFor(id: string, hints: DemoImageHints = {}): string | null {
  const key = `${hints.make ?? ''} ${hints.model ?? ''}`.toLowerCase().trim()

  const typedKey = `${hints.vehicleType ?? ''}|${key}`

  const local = LOCAL_EXACT[typedKey]
  if (local) return local

  let photo = MODEL_OVERRIDE[typedKey] ?? MODEL_EXACT[key]
  if (!photo) {
    const pool = poolFor(hints)
    if (pool.length === 0) return null
    photo = pool[hashToIndex(id, pool.length)]
  }
  return `${CDN}${photo}?auto=format&fit=crop&w=640&h=480&q=70`
}
