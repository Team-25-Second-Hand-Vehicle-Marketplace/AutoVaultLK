jest.mock('unzipper', () => ({ Open: { buffer: jest.fn() } }));
import { Readable } from 'node:stream';
import {
  generateVehicle,
  convertToCsv,
} from '../../../../src/tools/vehicle-generator/vehicle-generator';
import { splitChunksStage } from '../../../../src/workers/etl-worker/pipeline/parse/split-chunks.stage';
import { validateFileStage } from '../../../../src/workers/etl-worker/pipeline/validate/validate-file.stage';

const ctxFor = (content: string, written: Map<string, string>): never =>
  ({
    jobId: 'j',
    dealerId: 'd',
    chunkId: null,
    config: { chunkSize: 100 },
    store: {
      exists: () => Promise.resolve(true),
      getStream: () => Promise.resolve(Readable.from([Buffer.from(content)])),
      put: (k: string, b: string) => {
        written.set(k, b);
        return Promise.resolve(k);
      },
    },
  }) as never;

type Row = { rowNumber: number; raw: Record<string, string> };

/**
 * The vehicle generator is how fixtures and load tests are made, so its output
 * is the realistic input. The same vehicles written as CSV and as JSON must
 * reach the pipeline as identical cells - including the deliberately dirty modes.
 */
describe.each(['clean', 'mixed', 'dirty'] as const)(
  'generator output, %s mode',
  (mode) => {
    it('is identical through the CSV and JSON readers', async () => {
      const vehicles = Array.from({ length: 300 }, (_, i) => ({
        ...generateVehicle(i + 1, mode),
        registration_number: `T-${i + 1}`,
      }));
      const csv = convertToCsv(vehicles);
      const json = JSON.stringify(vehicles, null, 2);

      const wc = new Map<string, string>();
      const wj = new Map<string, string>();

      const vc = await validateFileStage.run(ctxFor(csv, wc), {
        key: 'k.csv',
        fileName: 'k.csv',
        format: 'csv',
      });
      const vj = await validateFileStage.run(ctxFor(json, wj), {
        key: 'k.json',
        fileName: 'k.json',
        format: 'json',
      });

      const rc = await splitChunksStage.run(ctxFor(csv, wc), {
        key: 'k.csv',
        format: 'csv',
        headers: [],
      });
      const rj = await splitChunksStage.run(ctxFor(json, wj), {
        key: 'k.json',
        format: 'json',
        headers: [],
      });
      const rowsC = [...wc.entries()]
        .filter(([k]) => k.includes('chunk'))
        .flatMap(([, b]) => JSON.parse(b) as Row[]);
      const rowsJ = [...wj.entries()]
        .filter(([k]) => k.includes('chunk'))
        .flatMap(([, b]) => JSON.parse(b) as Row[]);

      const diffs: string[] = [];
      rowsC.forEach((r, i) => {
        const j = rowsJ[i];
        for (const k of new Set([
          ...Object.keys(r.raw),
          ...Object.keys(j.raw),
        ])) {
          const a = r.raw[k] ?? '';
          const b = j.raw[k] ?? '';
          if (a !== b)
            diffs.push(
              `row ${r.rowNumber} ${k}: csv=${JSON.stringify(a)} json=${JSON.stringify(b)}`,
            );
        }
      });
      expect(rj.totalRecords).toBe(rc.totalRecords);
      expect(diffs).toEqual([]);
    });
  },
);
