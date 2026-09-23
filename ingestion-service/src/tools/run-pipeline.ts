/**
 * Runs the ETL pipeline against a real database, end to end, with no HTTP.
 *
 * Stands in for POST /ingest/upload (§B1) so Phase A can be verified before
 * that endpoint exists: it does exactly what the upload handler will do —
 * store the file(s), insert a PENDING job, publish to the queue — and then
 * waits for the pipeline to finish and prints what landed, row by row.
 *
 *   npx ts-node src/tools/run-pipeline.ts test/fixtures/e2e-mixed.csv
 *   npx ts-node src/tools/run-pipeline.ts <file.csv> --zip <photos.zip>
 *   npx ts-node src/tools/run-pipeline.ts <file.csv> --job <existingJobId>
 *
 * Run with ts-node, not tsx: tsx (esbuild) strips types per-file without a
 * type-checking pass, and Nest's DI relies on emitDecoratorMetadata, which
 * needs one — under tsx, constructor params resolve to undefined at runtime
 * and the app fails to boot with an UndefinedDependencyException.
 *
 * The --job form re-runs an existing job, which is how the idempotency claim
 * in §A8 is checked: the row count must not change.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { OBJECT_STORE } from '../infrastructure/ports/object-store.port';
import type { ObjectStore } from '../infrastructure/ports/object-store.port';
import { UploadJobRepository } from '../modules/ingestion/repositories/upload-job.repository';
import { LocalOrchestrator } from '../workers/etl-worker/local-orchestrator';

async function main(): Promise<void> {
  const [filePath, ...rest] = process.argv.slice(2);
  if (!filePath) {
    console.error(
      'usage: ts-node src/tools/run-pipeline.ts <file.csv> [--zip <photos.zip>] [--job <id>]',
    );
    process.exit(1);
  }

  const jobFlag = rest.indexOf('--job');
  const existingJobId = jobFlag === -1 ? undefined : rest[jobFlag + 1];

  const zipFlag = rest.indexOf('--zip');
  const zipPath = zipFlag === -1 ? undefined : rest[zipFlag + 1];

  // Full application context: the same providers, config and connection pool
  // the service uses in production. A hand-wired subset would prove less.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  const store = app.get<ObjectStore>(OBJECT_STORE);
  const uploadJobs = app.get(UploadJobRepository);
  const orchestrator = app.get(LocalOrchestrator);
  const dataSource = app.get(DataSource);

  try {
    const jobId =
      existingJobId ?? (await createJob(store, uploadJobs, dataSource, filePath, zipPath));

    console.log(`\n─── running pipeline for job ${jobId} ───\n`);
    const startedAt = Date.now();
    await orchestrator.run(jobId);
    console.log(`\n─── finished in ${Date.now() - startedAt}ms ───\n`);

    await report(dataSource, jobId, filePath);
  } finally {
    await app.close();
  }
}

async function createJob(
  store: ObjectStore,
  uploadJobs: UploadJobRepository,
  dataSource: DataSource,
  filePath: string,
  zipPath?: string,
): Promise<string> {
  // Any dealer will do — the pipeline reads dealer_id from the job, never from
  // the file, so which one is arbitrary for this check.
  const [dealer] = (await dataSource.query(
    `SELECT id, email FROM auth.users WHERE role = 'DEALER' LIMIT 1`,
  )) as { id: string; email: string }[];

  if (!dealer) {
    throw new Error('No DEALER user found. Run the auth seed first.');
  }

  const fileName = basename(filePath);
  const contents = readFileSync(resolve(filePath));

  // Job first: the storage key contains its id, exactly as B1 will do it.
  const job = await uploadJobs.create({
    dealerId: dealer.id,
    fileName,
    csvS3Path: 'pending',
  });

  const key = `raw/${job.id}/${fileName}`;
  await store.put(key, contents);

  let zipKey: string | null = null;
  if (zipPath) {
    const zipFileName = basename(zipPath);
    const zipContents = readFileSync(resolve(zipPath));
    zipKey = `raw/${job.id}/${zipFileName}`;
    await store.put(zipKey, zipContents);
  }

  await dataSource.query(
    `UPDATE ingestion.upload_jobs SET csv_s3_path = $1, zip_s3_path = $2 WHERE id = $3`,
    [key, zipKey, job.id],
  );

  console.log(`dealer   ${dealer.email} (${dealer.id})`);
  console.log(`file     ${fileName} (${contents.byteLength} bytes)`);
  console.log(`stored   ${key}`);
  if (zipKey) {
    console.log(`zip      ${basename(zipPath!)}`);
    console.log(`stored   ${zipKey}`);
  }

  return job.id;
}

/**
 * The SQL checks from the plan's verification section, plus a per-row
 * breakdown that answers "what happened to the exact record I typed in row
 * N" rather than only aggregate counts and a 5-row truncated sample.
 */
async function report(dataSource: DataSource, jobId: string, filePath: string): Promise<void> {
  const [job] = (await dataSource.query(
    `SELECT status, total_records, valid_records, invalid_records
       FROM ingestion.upload_jobs WHERE id = $1`,
    [jobId],
  )) as Record<string, unknown>[];

  console.log('JOB');
  console.table([job]);

  const stages = (await dataSource.query(
    `SELECT stage, status, count(*) AS chunks
       FROM ingestion.etl_stage_logs WHERE upload_job_id = $1
      GROUP BY stage, status ORDER BY min(started_at)`,
    [jobId],
  )) as Record<string, unknown>[];

  console.log('\nSTAGES');
  console.table(stages);

  const [vehicles] = (await dataSource.query(
    `SELECT count(*)                                              AS loaded,
            count(*) FILTER (WHERE status <> 'PENDING_REVIEW')    AS wrong_status,
            count(*) FILTER (WHERE search_vector IS NULL)         AS no_search_vector,
            count(*) FILTER (WHERE embedding IS NULL)             AS no_embedding,
            count(*) FILTER (WHERE dealer_id IS NULL)             AS no_dealer,
            count(*) FILTER (WHERE needs_manual_review)           AS needs_review
       FROM marketplace.vehicles WHERE upload_job_id = $1`,
    [jobId],
  )) as Record<string, unknown>[];

  console.log('\nVEHICLES  (wrong_status / no_search_vector / no_dealer must be 0)');
  console.table([vehicles]);

  await reportPerRow(dataSource, jobId, filePath);

  console.log(`\nre-run to check idempotency:`);
  console.log(`  npx ts-node src/tools/run-pipeline.ts <file> --job ${jobId}\n`);
}

/**
 * Re-reads the source CSV and, for every data row (1-based, header excluded —
 * the same numbering rejected_records uses), prints exactly one outcome line:
 * either the loaded vehicle's stored state, or the rejection reason. This is
 * the answer to "what happened to the record on row N", which the old
 * aggregate-only report (job counts + a 5-row sample) could not give: a
 * dealer re-uploading the same three rows across test runs would see the
 * SAME five loaded rows every time, never their own.
 */
async function reportPerRow(dataSource: DataSource, jobId: string, filePath: string): Promise<void> {
  const rawRows = parse(readFileSync(resolve(filePath), 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  const rejections = (await dataSource.query(
    `SELECT row_number, reason FROM ingestion.rejected_records WHERE upload_job_id = $1`,
    [jobId],
  )) as { row_number: number; reason: string }[];
  const rejectionByRow = new Map(rejections.map((r) => [r.row_number, r.reason]));

  const loaded = (await dataSource.query(
    `SELECT id, registration_number, make, model, manufacture_year, vehicle_type,
            condition, fuel_type, transmission_type, color, engine_capacity_cc,
            owners_count, location_district, status, needs_manual_review,
            review_reason, specs, description,
            embedding IS NOT NULL AS has_embedding
       FROM marketplace.vehicles WHERE upload_job_id = $1`,
    [jobId],
  )) as Record<string, unknown>[];

  // registration_number is the join key back to the CSV row; rows with a
  // blank registration cannot be matched back this way and are reported by
  // position among the still-unmatched loaded rows instead, best-effort.
  const loadedByRegistration = new Map(
    loaded
      .filter((v) => v.registration_number)
      .map((v) => [v.registration_number as string, v]),
  );
  const loadedWithoutRegistration = loaded.filter((v) => !v.registration_number);
  let unregisteredCursor = 0;

  const imagesByVehicle = new Map<string, { s3_path: string; is_primary: boolean; display_order: number }[]>();
  if (loaded.length > 0) {
    const images = (await dataSource.query(
      `SELECT vehicle_id, s3_path, is_primary, display_order
         FROM marketplace.vehicle_images WHERE vehicle_id = ANY($1::uuid[])
        ORDER BY vehicle_id, display_order`,
      [loaded.map((v) => v.id)],
    )) as { vehicle_id: string; s3_path: string; is_primary: boolean; display_order: number }[];

    for (const img of images) {
      const list = imagesByVehicle.get(img.vehicle_id) ?? [];
      list.push(img);
      imagesByVehicle.set(img.vehicle_id, list);
    }
  }

  console.log('\nPER-ROW OUTCOME  (row numbers match rejected_records / your CSV, header excluded)');

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 1;
    const reg = raw.registration_number?.trim();

    console.log(`\n── row ${rowNumber} ── ${raw.make ?? ''} ${raw.model ?? ''} (${reg || 'no registration_number'})`);

    const rejectionReason = rejectionByRow.get(rowNumber);
    if (rejectionReason) {
      console.log(`   REJECTED: ${rejectionReason}`);
      return;
    }

    const vehicle = reg
      ? loadedByRegistration.get(reg)
      : loadedWithoutRegistration[unregisteredCursor++];

    if (!vehicle) {
      console.log('   not found — check row_number offsets if the file has blank lines');
      return;
    }

    console.log(
      `   LOADED   status=${vehicle.status} vehicle_type=${vehicle.vehicle_type} ` +
        `make=${vehicle.make} model=${vehicle.model} year=${vehicle.manufacture_year}`,
    );
    console.log(
      `            condition=${vehicle.condition} fuel_type=${vehicle.fuel_type} ` +
        `transmission=${vehicle.transmission_type} color=${vehicle.color} ` +
        `engine_cc=${vehicle.engine_capacity_cc} owners=${vehicle.owners_count} ` +
        `district=${vehicle.location_district}`,
    );
    console.log(
      `            needs_manual_review=${vehicle.needs_manual_review} ` +
        `review_reason=${vehicle.review_reason ?? 'none'} has_embedding=${vehicle.has_embedding}`,
    );
    console.log(`            specs=${JSON.stringify(vehicle.specs)}`);
    console.log(`            description=${JSON.stringify(vehicle.description)}`);

    const images = imagesByVehicle.get(vehicle.id as string) ?? [];
    if (images.length === 0) {
      console.log('            images: none matched');
    } else {
      for (const img of images) {
        console.log(
          `            image: ${img.s3_path} (${img.is_primary ? 'PRIMARY' : 'gallery'}, order ${img.display_order})`,
        );
      }
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
