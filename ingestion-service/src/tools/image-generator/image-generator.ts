// Generates synthetic vehicle images and zips them for the ETL pipeline's
// --zip flag, matching the naming convention extract-images.stage.ts parses:
// <REG>.<ext>, <REG>_2.<ext>, <REG>_3.<ext> (any trailing _<integer> works).
//
// Deliberately oversized (3000x2000 by default) so a before/after size
// comparison against the pipeline's processed output (1600x1200 main /
// 400x300 thumbnail, see image-processing.stage.ts) is meaningful.
import { createWriteStream, existsSync } from 'fs';
import { mkdir, readFile, stat } from 'fs/promises';
import { join } from 'path';
import archiver from 'archiver';
import sharp from 'sharp';

type Args = {
  fromCsv?: string;
  count: number;
  perVehicle: number;
  width: number;
  height: number;
  output: string;
};

function parseArguments(): Args {
  const args = process.argv.slice(2);

  let fromCsv: string | undefined;
  let count = 10;
  let perVehicle = 2;
  let width = 3000;
  let height = 2000;
  let output = 'test-data/generated-images.zip';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--from-csv':
        fromCsv = args[++i];
        break;
      case '--count':
        count = Number(args[++i]);
        break;
      case '--per-vehicle':
        perVehicle = Number(args[++i]);
        break;
      case '--width':
        width = Number(args[++i]);
        break;
      case '--height':
        height = Number(args[++i]);
        break;
      case '--output':
        output = args[++i];
        break;
    }
  }

  if (!fromCsv && (!Number.isInteger(count) || count <= 0)) {
    throw new Error('--count must be a positive integer when --from-csv is not given');
  }
  if (!Number.isInteger(perVehicle) || perVehicle <= 0) {
    throw new Error('--per-vehicle must be a positive integer');
  }
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new Error('--width/--height must be positive integers');
  }

  return { fromCsv, count, perVehicle, width, height, output };
}

/** Pulls registration_number out of a generator CSV — first column, header row skipped. */
export async function registrationsFromCsv(path: string): Promise<string[]> {
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

function generateRegistrations(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `IMG-${String(i + 1).padStart(4, '0')}`);
}

/** A distinct, deterministic color per registration so images are visibly different, not noise. */
function colorFor(registration: string): { r: number; g: number; b: number } {
  let hash = 0;
  for (const char of registration) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return { r: hash % 256, g: (hash >> 8) % 256, b: (hash >> 16) % 256 };
}

/** One oversized synthetic JPEG with the registration number and image index burned in as text. */
export async function buildImage(
  registration: string,
  index: number,
  width: number,
  height: number,
): Promise<Buffer> {
  const { r, g, b } = colorFor(registration);
  const label = index === 1 ? registration : `${registration} (${index})`;
  const fontSize = Math.round(Math.min(width, height) / 10);

  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="rgb(${r},${g},${b})" />
      <text x="50%" y="50%" font-size="${fontSize}" fill="white"
            text-anchor="middle" dominant-baseline="middle"
            font-family="sans-serif">${label}</text>
    </svg>`;

  return sharp(Buffer.from(svg))
    // Uncompressed-ish quality on purpose: this is the synthetic "camera
    // original" the pipeline is supposed to shrink, not a pre-optimized file.
    .jpeg({ quality: 95, mozjpeg: false })
    .toBuffer();
}

async function main() {
  const args = parseArguments();

  const registrations = args.fromCsv
    ? await registrationsFromCsv(args.fromCsv)
    : generateRegistrations(args.count);

  const outputDir = join(args.output, '..');
  if (!existsSync(outputDir)) {
    await mkdir(outputDir, { recursive: true });
  }

  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = createWriteStream(args.output);
  const done = new Promise<void>((resolve, reject) => {
    stream.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(stream);

  let totalOriginalBytes = 0;
  let fileCount = 0;

  for (const registration of registrations) {
    for (let i = 1; i <= args.perVehicle; i++) {
      const buffer = await buildImage(registration, i, args.width, args.height);
      const name = i === 1 ? `${registration}.jpg` : `${registration}_${i}.jpg`;
      archive.append(buffer, { name });
      totalOriginalBytes += buffer.length;
      fileCount++;
    }
  }

  await archive.finalize();
  await done;

  const zipStat = await stat(args.output);

  console.log(`Generated ${fileCount} images for ${registrations.length} vehicles.`);
  console.log(`Dimensions: ${args.width}x${args.height}`);
  console.log(`Total uncompressed image bytes: ${totalOriginalBytes.toLocaleString()}`);
  console.log(`Output zip: ${args.output} (${zipStat.size.toLocaleString()} bytes)`);
}

// Guarded so ingestion-tester.ts can import buildImage/registrationsFromCsv
// without also triggering this file's own CLI run as a side effect of import.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
