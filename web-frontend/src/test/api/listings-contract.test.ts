/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  CONDITIONS,
  FUEL_TYPES,
  LISTABLE_VEHICLE_TYPES,
  MANUAL_STATUSES,
  TRANSMISSION_TYPES,
} from '../../api/listings.types'

/**
 * Drift guard between the manual listing form's selects and the DTO that
 * validates them.
 *
 * The lists in `listings.types.ts` are a copy — the two services build
 * independently, so the frontend has no import path into
 * `create-listing.dto.ts`. This reads that file off disk and compares. Without
 * it, a backend enum change ships a form whose options produce a 400 the dealer
 * cannot act on, and nothing fails until someone tries it by hand.
 *
 * Uses `node:fs` rather than Vite's `import.meta.glob`, which refuses paths
 * outside the project root. The triple-slash reference keeps Node types local
 * rather than widening tsconfig.app.json for all of src/.
 *
 * Skips itself when the sibling service is absent — a frontend-only checkout,
 * or once the repos split.
 */
const CONSTANTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../marketplace-service/src/modules/search/constants/vehicle-attributes.constants.ts',
)

const DTO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../marketplace-service/src/modules/listings/dto/create-listing.dto.ts',
)

/** Reads a `export const NAME = [...] as const` string array. */
function readArray(source: string, name: string): string[] {
  const match = new RegExp(`export const ${name}\\s*=\\s*\\[([^\\]]*)\\]`, 's').exec(source)
  if (!match) throw new Error(`${name} not found in vehicle-attributes.constants.ts`)

  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** Reads the values out of a `export enum Name { KEY = 'VALUE', ... }` block. */
function readEnum(source: string, name: string): string[] {
  const match = new RegExp(`export enum ${name}\\s*\\{([^}]*)\\}`, 's').exec(source)
  if (!match) throw new Error(`${name} not found in create-listing.dto.ts`)

  return [...match[1].matchAll(/=\s*'([^']+)'/g)].map((m) => m[1])
}

const present = existsSync(CONSTANTS) && existsSync(DTO)
const describeIfPresent = present ? describe : describe.skip

describeIfPresent('manual listing vocabulary parity', () => {
  const constants = present ? readFileSync(CONSTANTS, 'utf8') : ''
  const dto = present ? readFileSync(DTO, 'utf8') : ''

  it('offers every vehicle type the backend accepts', () => {
    // All eleven. This was six on both sides until the DTO was fixed; a
    // dealer could bulk-upload a lorry but not create one by hand.
    expect([...LISTABLE_VEHICLE_TYPES]).toEqual(readArray(constants, 'VEHICLE_TYPES'))
  })

  it('fuel types match', () => {
    expect([...FUEL_TYPES]).toEqual(readArray(constants, 'FUEL_TYPES'))
  })

  it('transmissions match', () => {
    expect([...TRANSMISSION_TYPES]).toEqual(readArray(constants, 'TRANSMISSION_TYPES'))
  })

  it('conditions match', () => {
    expect([...CONDITIONS]).toEqual(readArray(constants, 'CONDITIONS'))
  })

  it('statuses match ManualListingStatusDto', () => {
    // Still a hand-written enum in the DTO, and rightly so: DRAFT and LIVE are
    // what a *dealer* may set, which is a narrower question than what the
    // status column allows.
    expect([...MANUAL_STATUSES]).toEqual(readEnum(dto, 'ManualListingStatusDto'))
  })
})
