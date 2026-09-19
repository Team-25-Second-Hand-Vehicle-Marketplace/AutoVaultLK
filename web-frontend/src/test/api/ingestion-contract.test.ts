/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { REQUIRED_COLUMNS, TEMPLATE_HEADER } from '../../api/ingestion.template'

/**
 * Drift guard between the downloadable template and the parser that reads it.
 *
 * ingestion.template.ts is a deliberate copy of ingestion-service's
 * csv-contract.ts — the two services build independently, so the frontend has
 * no import path into it. This reads that file off disk and compares, turning
 * a silent mismatch into a red build.
 *
 * node:fs rather than Vite's import.meta.glob, which refuses to load anything
 * outside the project root (`Denied ID …`). That sandbox is a good default and
 * not worth relaxing for a test; this file runs only under vitest in Node, and
 * the triple-slash reference keeps the Node types local rather than widening
 * tsconfig.app.json for all of src/.
 *
 * Skips itself when the sibling service is absent (a frontend-only checkout,
 * or once the repos split), at which point this becomes a published-contract
 * problem instead.
 */
const CONTRACT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../ingestion-service/src/workers/etl-worker/pipeline/parse/csv-contract.ts',
)

/** Reads an `export const NAME = [...]` string array out of the source. */
function readStringArray(source: string, name: string): string[] {
  const match = new RegExp(`export const ${name}[^=]*=\\s*\\[([^\\]]*)\\]`, 's').exec(source)
  if (!match) throw new Error(`${name} not found in csv-contract.ts`)

  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

const present = existsSync(CONTRACT)
const describeIfPresent = present ? describe : describe.skip

describeIfPresent('dealer CSV contract parity', () => {
  const source = present ? readFileSync(CONTRACT, 'utf8') : ''

  it('template header matches ingestion-service', () => {
    // If this fails, the template we hand dealers no longer matches what the
    // parser expects: their first upload rejects on a file we generated.
    expect([...TEMPLATE_HEADER]).toEqual(readStringArray(source, 'TEMPLATE_HEADER'))
  })

  it('required columns match ingestion-service', () => {
    // These drive the "required" markers on the column reference. Marking a
    // column optional that validateFile insists on is a guaranteed failed
    // upload with no warning on the page.
    expect([...REQUIRED_COLUMNS]).toEqual(readStringArray(source, 'REQUIRED_COLUMNS'))
  })
})
