/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  ALL_LISTING_STATUSES,
  CONDITIONS,
  FUEL_TYPES,
  LISTABLE_VEHICLE_TYPES,
  MANUAL_STATUSES,
  TRANSMISSION_TYPES,
} from '../../api/listings.types'

const CONSTANTS = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../marketplace-service/src/modules/search/constants/vehicle-attributes.constants.ts',
)

const DTO = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../marketplace-service/src/modules/listings/dto/create-listing.dto.ts',
)

const VEHICLE_ENTITY = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../marketplace-service/src/infrastructure/database/entities/vehicle.entity.ts',
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

/** Reads the members of a `export type Name = 'A' | 'B' | ...;` union-of-string-literals alias. */
function readUnionType(source: string, name: string): string[] {
  const match = new RegExp(`export type ${name}\\s*=([^;]*);`, 's').exec(source)
  if (!match) throw new Error(`${name} not found in vehicle.entity.ts`)

  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
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

const vehicleEntityPresent = existsSync(VEHICLE_ENTITY)
const describeIfVehicleEntityPresent = vehicleEntityPresent ? describe : describe.skip

describeIfVehicleEntityPresent('listing status vocabulary parity', () => {
  const vehicleEntity = vehicleEntityPresent ? readFileSync(VEHICLE_ENTITY, 'utf8') : ''

  it('DealerListing/ListingStatus covers every status VehicleStatus allows', () => {
    // The two sides are hand-maintained independently (vehicle.entity.ts's
    // VehicleStatus vs. this file's ALL_LISTING_STATUSES) - nothing stops
    // someone adding a status to one and forgetting the other, and nothing
    // fails until a real search/dashboard response carries a status value
    // the frontend's switch/display logic has never seen.
    expect([...ALL_LISTING_STATUSES]).toEqual(readUnionType(vehicleEntity, 'VehicleStatus'))
  })
})
