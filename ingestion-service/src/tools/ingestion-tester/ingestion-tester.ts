/**
 * One-command ETL test: generate a CSV + matching image ZIP, run them
 * through the real pipeline, and produce a single HTML report covering every
 * row's outcome, every image's compression, and embedding coverage.
 *
 * Sits alongside vehicle-generator.ts and image-generator.ts (which this
 * reuses in-process, not by shelling out) and run-pipeline.ts (whose job
 * creation / orchestrator invocation this also reuses). Built because manual
 * testing so far meant three separate commands plus reading a wall of
 * console.table output — this exists to make one full pipeline pass
 * reviewable as a single artifact.
 *
 *   npx ts-node src/tools/ingestion-tester/ingestion-tester.ts --count 50
 *   npx ts-node src/tools/ingestion-tester/ingestion-tester.ts --count 50 --dealer you@example.com
 *   npx ts-node src/tools/ingestion-tester/ingestion-tester.ts --count 50 --images-per-vehicle 3
 *   npx ts-node src/tools/ingestion-tester/ingestion-tester.ts --count 50 --no-images
 *
 * Run with ts-node, not tsx — see run-pipeline.ts's comment: Nest's DI needs
 * emitDecoratorMetadata's type-checking pass, which tsx skips.
 *
 * Vehicles land as PENDING_REVIEW, exactly like a real dealer's bulk upload —
 * this tool does not auto-approve them to LIVE. The report says so plainly so
 * "not visible in marketplace search yet" is never mistaken for a bug.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../../app.module';
import { OBJECT_STORE } from '../../infrastructure/ports/object-store.port';
import type { ObjectStore } from '../../infrastructure/ports/object-store.port';
import { UploadJobRepository } from '../../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from '../../workers/etl-worker/local-orchestrator';
import {
  convertToCsv,
  generateVehicle,
  type GenerationMode,
  type Vehicle,
} from '../vehicle-generator/vehicle-generator';
import { buildImage } from '../image-generator/image-generator';
import archiver from 'archiver';
import { buildReport } from './report';
import type { GeneratedImage } from './report';

type Args = {
  count: number;
  mode: GenerationMode;
  dealerEmail?: string;
  images: boolean;
  imagesPerVehicle: number;
  imageWidth: number;
  imageHeight: number;
  outDir: string;
};

function parseArguments(): Args {
  const args = process.argv.slice(2);

  let count = 50;
  let mode: GenerationMode = 'mixed';
  let dealerEmail: string | undefined;
  let images = true;
  let imagesPerVehicle = 2;
  let imageWidth = 3000;
  let imageHeight = 2000;
  let outDir = 'test-runs';

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':
        count = Number(args[++i]);
        break;
      case '--mode':
        mode = args[++i] as GenerationMode;
        break;
      case '--dealer':
        dealerEmail = args[++i];
        break;
      case '--no-images':
        images = false;
        break;
      case '--images-per-vehicle':
        imagesPerVehicle = Number(args[++i]);
        break;
      case '--image-width':
        imageWidth = Number(args[++i]);
        break;
      case '--image-height':
        imageHeight = Number(args[++i]);
        break;
      case '--out-dir':
        outDir = args[++i];
        break;
    }
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error('--count must be a positive integer');
  }
  if (!['clean', 'dirty', 'invalid', 'mixed'].includes(mode)) {
    throw new Error('--mode must be clean, dirty, invalid, or mixed');
  }

  return { count, mode, dealerEmail, images, imagesPerVehicle, imageWidth, imageHeight, outDir };
}

/** Every run gets its own timestamped folder so nothing overwrites a prior run's report. */
function runFolderName(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/**
 * Registrations from generateVehicle collide across runs (deterministic
 * WP-0001.. sequence) — the same problem worked around by hand with a prefix
 * swap in earlier manual testing. Each run gets its own short random prefix
 * instead, so re-running this tool never collides with a previous run's rows
 * still sitting in the database.
 */
function runPrefix(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function main(): Promise<void> {
  const args = parseArguments();
  const prefix = runPrefix();

  const folder = join(args.outDir, runFolderName());
  await mkdir(resolve(folder), { recursive: true });

  // 1. Generate the CSV in-process (no subprocess, no intermediate file
  // written by a separate tool invocation).
  const vehicles: Vehicle[] = Array.from({ length: args.count }, (_, i) => {
    const vehicle = generateVehicle(i + 1, args.mode);
    return { ...vehicle, registration_number: `${prefix}-${String(i + 1).padStart(4, '0')}` };
  });
  const csvContent = convertToCsv(vehicles);
  const csvPath = join(folder, 'input.csv');
  await writeFile(resolve(csvPath), csvContent, 'utf8');
  console.log(`csv      ${csvPath} (${vehicles.length} rows, prefix ${prefix})`);

  // 2. Generate matching images + zip, in-process.
  let zipPath: string | undefined;
  const generatedImages: GeneratedImage[] = [];
  if (args.images) {
    zipPath = join(folder, 'input-images.zip');
    const archive = archiver('zip', { zlib: { level: 9 } });
    const { createWriteStream } = await import('node:fs');
    const stream = createWriteStream(resolve(zipPath));
    const done = new Promise<void>((res, rej) => {
      stream.on('close', res);
      archive.on('error', rej);
    });
    archive.pipe(stream);

    for (const vehicle of vehicles) {
      for (let i = 1; i <= args.imagesPerVehicle; i++) {
        const buffer = await buildImage(
          vehicle.registration_number,
          i,
          args.imageWidth,
          args.imageHeight,
        );
        const fileName =
          i === 1 ? `${vehicle.registration_number}.jpg` : `${vehicle.registration_number}_${i}.jpg`;
        archive.append(buffer, { name: fileName });
        generatedImages.push({
          registrationNumber: vehicle.registration_number,
          fileName,
          originalBytes: buffer.length,
        });
      }
    }

    await archive.finalize();
    await done;
    console.log(`zip      ${zipPath} (${generatedImages.length} images)`);
  }

  // 3. Run the real pipeline, in-process — same providers, same connection
  // pool run-pipeline.ts uses, so this proves what production code actually
  // does, not a hand-rolled subset of it.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['warn', 'error'],
  });

  const store = app.get<ObjectStore>(OBJECT_STORE);
  const uploadJobs = app.get(UploadJobRepository);
  const orchestrator = app.get(LocalOrchestrator);
  const dataSource = app.get(DataSource);

  try {
    const [dealer] = (await dataSource.query(
      args.dealerEmail
        ? `SELECT id, email FROM auth.users WHERE role = 'DEALER' AND email = $1 LIMIT 1`
        : `SELECT id, email FROM auth.users WHERE role = 'DEALER' LIMIT 1`,
      args.dealerEmail ? [args.dealerEmail] : [],
    )) as { id: string; email: string }[];

    if (!dealer) {
      throw new Error(
        args.dealerEmail
          ? `No DEALER user found with email ${args.dealerEmail}.`
          : 'No DEALER user found. Run the auth seed first.',
      );
    }

    const job = await uploadJobs.create({
      dealerId: dealer.id,
      fileName: 'input.csv',
      csvS3Path: 'pending',
    });

    const csvKey = `raw/${job.id}/input.csv`;
    await store.put(csvKey, csvContent);

    let zipKey: string | null = null;
    if (zipPath) {
      const { readFile } = await import('node:fs/promises');
      const zipBuffer = await readFile(resolve(zipPath));
      zipKey = `raw/${job.id}/input-images.zip`;
      await store.put(zipKey, zipBuffer);
    }

    await dataSource.query(
      `UPDATE ingestion.upload_jobs SET csv_s3_path = $1, zip_s3_path = $2 WHERE id = $3`,
      [csvKey, zipKey, job.id],
    );

    console.log(`dealer   ${dealer.email} (${dealer.id})`);
    console.log(`\n─── running pipeline for job ${job.id} ───\n`);
    const startedAt = Date.now();
    await orchestrator.run(job.id);
    const durationMs = Date.now() - startedAt;
    console.log(`─── finished in ${durationMs}ms ───\n`);

    // 4. Build the HTML report from the job's actual DB state.
    const reportPath = join(folder, 'report.html');
    await buildReport({
      dataSource,
      store,
      jobId: job.id,
      dealerEmail: dealer.email,
      vehicles,
      generatedImages,
      durationMs,
      outputPath: resolve(reportPath),
    });

    console.log(`report   ${reportPath}`);
    console.log(`\nOpen the report, or re-run to check idempotency:`);
    console.log(`  npx ts-node src/tools/run-pipeline.ts ${csvPath} --job ${job.id}\n`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
