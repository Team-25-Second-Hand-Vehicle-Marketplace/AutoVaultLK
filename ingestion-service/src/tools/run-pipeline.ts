/**
 * Runs the ETL pipeline against a real database, end to end, with no HTTP.
 *
 * Stands in for POST /ingest/upload (§B1) so Phase A can be verified before
 * that endpoint exists: it does exactly what the upload handler will do —
 * store the file, insert a PENDING job, publish to the queue — and then waits
 * for the pipeline to finish and prints what landed.
 *
 *   npx tsx src/tools/run-pipeline.ts test/fixtures/e2e-mixed.csv
 *   npx tsx src/tools/run-pipeline.ts <file.csv> --job <existingJobId>
 *
 * The --job form re-runs an existing job, which is how the idempotency claim
 * in §A8 is checked: the row count must not change.
 */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
    console.error('usage: tsx src/tools/run-pipeline.ts <file.csv> [--job <id>]');
    process.exit(1);
  }

  const jobFlag = rest.indexOf('--job');
  const existingJobId = jobFlag === -1 ? undefined : rest[jobFlag + 1];

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
    const jobId = existingJobId ?? (await createJob(store, uploadJobs, dataSource, filePath));

    console.log(`\n─── running pipeline for job ${jobId} ───\n`);
    const startedAt = Date.now();
    await orchestrator.run(jobId);
    console.log(`\n─── finished in ${Date.now() - startedAt}ms ───\n`);

    await report(dataSource, jobId);
  } finally {
    await app.close();
  }
}

async function createJob(
  store: ObjectStore,
  uploadJobs: UploadJobRepository,
  dataSource: DataSource,
  filePath: string,
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
  await dataSource.query(`UPDATE ingestion.upload_jobs SET csv_s3_path = $1 WHERE id = $2`, [
    key,
    job.id,
  ]);

  console.log(`dealer   ${dealer.email} (${dealer.id})`);
  console.log(`file     ${fileName} (${contents.byteLength} bytes)`);
  console.log(`stored   ${key}`);

  return job.id;
}

/** The SQL checks from the plan's verification section, run automatically. */
async function report(dataSource: DataSource, jobId: string): Promise<void> {
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
            count(*) FILTER (WHERE dealer_id IS NULL)             AS no_dealer
       FROM marketplace.vehicles WHERE upload_job_id = $1`,
    [jobId],
  )) as Record<string, unknown>[];

  console.log('\nVEHICLES  (wrong_status / no_search_vector / no_dealer must be 0)');
  console.table([vehicles]);

  const rejections = (await dataSource.query(
    `SELECT row_number, left(reason, 90) AS reason
       FROM ingestion.rejected_records WHERE upload_job_id = $1
      ORDER BY row_number LIMIT 15`,
    [jobId],
  )) as Record<string, unknown>[];

  if (rejections.length > 0) {
    console.log('\nREJECTED  (first 15)');
    console.table(rejections);
  }

  const sample = (await dataSource.query(
    `SELECT make, model, manufacture_year AS year, vehicle_type, fuel_type,
            specs->>'body_type' AS body_type, left(search_text, 52) AS search_text
       FROM marketplace.vehicles WHERE upload_job_id = $1
      ORDER BY created_at LIMIT 5`,
    [jobId],
  )) as Record<string, unknown>[];

  console.log('\nSAMPLE');
  console.table(sample);

  console.log(`\nre-run to check idempotency:`);
  console.log(`  npx tsx src/tools/run-pipeline.ts <file> --job ${jobId}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
