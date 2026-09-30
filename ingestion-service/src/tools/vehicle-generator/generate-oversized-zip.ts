// Builds a ZIP of a target total size using random (incompressible) bytes
// per entry, for the large-ZIP upload stress test
// (performance/scripts/large-zip-upload-stress.js).
//
// image-generator.ts's synthetic images are flat-color SVG-to-JPEG renders
// that compress to a few KB regardless of --width/--height (confirmed: 3000x2000
// -> ~34KB/image), so reaching anywhere near the real 250MB cap
// (ingestion-upload.service.ts's maxZipSize) through that tool alone would
// need far more than MAX_ZIP_ENTRIES=2000 entries. This test isn't about
// realistic photo content — it's about whether upload/multipart-parsing/
// streaming survives a ZIP near the real size ceiling — so entries here are
// deliberately random bytes, sized to hit a target total directly.
//
// --from-csv: an earlier version of this tool always named entries
// STRESS-0001.jpg etc., unconditionally, regardless of the paired CSV's
// real registration numbers — which meant every entry was permanently
// "unmatched" in process-job-images.service.ts, each paying the full 30s
// findVehicleWithRetry budget (MATCH_RETRY_BUDGET_MS) before PROCESS_IMAGES
// ever reached Sharp at all. Confirmed the hard way: two separate large-ZIP
// stress runs against mismatched fixtures both looked identical to a
// PROCESS_IMAGES hang for 5+ minutes, and were still indistinguishable from
// one at that point — the unmatched-retry wait and a genuine Sharp hang
// both present as "STARTED, no completed_at, no progress" for several
// minutes. Passing --from-csv (same registrationsFromCsv() helper
// image-generator.ts already uses) makes entries match real rows, so a job
// actually reaches Sharp instead of stalling in the match-retry loop.
import { createWriteStream } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';
import archiver from 'archiver';

type Args = {
  targetMb: number;
  entries: number;
  output: string;
  fromCsv?: string;
};

function parseArguments(): Args {
  const args = process.argv.slice(2);
  let targetMb = 230;
  let entries = 50;
  let output = 'test-data/generated-oversized.zip';
  let fromCsv: string | undefined;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--target-mb':
        targetMb = Number(args[++i]);
        break;
      case '--entries':
        entries = Number(args[++i]);
        break;
      case '--output':
        output = args[++i];
        break;
      case '--from-csv':
        fromCsv = args[++i];
        break;
    }
  }

  if (!fromCsv && (!Number.isInteger(entries) || entries <= 0)) {
    throw new Error('--entries must be a positive integer when --from-csv is not given');
  }
  if (!(targetMb > 0)) {
    throw new Error('--target-mb must be a positive number');
  }
  return { targetMb, entries, output, fromCsv };
}

/** Pulls registration_number out of a generator CSV — same logic as image-generator.ts's own helper. */
async function registrationsFromCsv(path: string): Promise<string[]> {
  const content = await readFile(path, 'utf-8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const [header, ...rows] = lines;

  const columns = header.split(',').map((col) => col.trim());
  const regIndex = columns.indexOf('registration_number');
  if (regIndex === -1) {
    throw new Error(`registration_number column not found in ${path}`);
  }

  return rows.map((row) => row.split(',')[regIndex].trim()).filter(Boolean);
}

async function main() {
  const { targetMb, entries: entriesArg, output, fromCsv } = parseArguments();

  const registrations = fromCsv ? await registrationsFromCsv(fromCsv) : null;
  const entries = registrations ? registrations.length : entriesArg;

  const outputDir = join(output, '..');
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  // zlib can't meaningfully shrink random bytes, so store mode (level 0)
  // keeps the written ZIP size close to the sum of entry sizes, which is
  // what makes --target-mb an accurate knob rather than a guess.
  const archive = archiver('zip', { zlib: { level: 0 } });
  const stream = createWriteStream(output);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(stream);

  const targetBytes = targetMb * 1024 * 1024;
  const bytesPerEntry = Math.floor(targetBytes / entries);

  for (let i = 1; i <= entries; i++) {
    // Registration-number-shaped filenames so extract-images.stage.ts's
    // matching logic runs its normal path. With --from-csv, these now
    // genuinely match a real row's registration_number, same naming
    // convention image-generator.ts uses (<REG>.jpg for the first image).
    const name = registrations ? `${registrations[i - 1]}.jpg` : `STRESS-${String(i).padStart(4, '0')}.jpg`;
    archive.append(randomBytes(bytesPerEntry), { name });
  }

  await archive.finalize();
  await done;

  const zipStat = await stat(output);
  console.log(`Generated ${entries} random-byte entries, ~${bytesPerEntry} bytes each.`);
  console.log(`Output zip: ${output} (${zipStat.size.toLocaleString()} bytes, ${(zipStat.size / 1024 / 1024).toFixed(1)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
