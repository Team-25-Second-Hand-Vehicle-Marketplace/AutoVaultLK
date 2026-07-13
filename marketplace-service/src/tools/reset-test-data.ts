import { createInterface } from 'node:readline/promises';
import { config } from 'dotenv';
import { DataSource } from 'typeorm';

// quiet: dotenv's own startup banner is noise in a script whose real output
// is a destructive-action confirmation prompt.
config({ path: '../.env', quiet: true });
config({ quiet: true });

async function confirm(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${message} Type "yes" to continue: `);
  rl.close();
  return answer.trim().toLowerCase() === 'yes';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  const dealerFlag = args.indexOf('--dealer');
  const dealerEmail = dealerFlag === -1 ? undefined : args[dealerFlag + 1];

  const skipConfirm = args.includes('--yes');

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set (expected the marketplace superuser connection)');
  }

  const dataSource = new DataSource({ type: 'postgres', url });
  await dataSource.initialize();

  try {
    const dealerId = dealerEmail
      ? await resolveDealerId(dataSource, dealerEmail)
      : undefined;

    const scopeLabel = dealerEmail ? `dealer ${dealerEmail} (${dealerId})` : 'ALL dealers';
    const counts = await countAffected(dataSource, dealerId);

    console.log(`About to permanently delete, scoped to ${scopeLabel}:`);
    console.log(`  vehicles:          ${counts.vehicles}`);
    console.log(`  vehicle_images:    ${counts.vehicleImages} (cascades with vehicles)`);
    console.log(`  favourites:        ${counts.favourites} (cascades with vehicles)`);
    console.log(`  upload_jobs:       ${counts.uploadJobs}`);
    console.log(`  rejected_records:  ${counts.rejectedRecords} (cascades with upload_jobs)`);
    console.log(`  etl_stage_logs:    ${counts.etlStageLogs} (cascades with upload_jobs)`);

    if (!skipConfirm && !(await confirm('This cannot be undone.'))) {
      console.log('Aborted.');
      return;
    }

    await dataSource.transaction(async (manager) => {
      if (dealerId) {
        // vehicle_images/favourites cascade on vehicle_id (migrations 7000/10000).
        await manager.query('DELETE FROM marketplace.vehicles WHERE dealer_id = $1', [dealerId]);
        // upload_jobs is keyed by dealer_id directly; rejected_records/etl_stage_logs cascade on upload_job_id.
        await manager.query('DELETE FROM ingestion.upload_jobs WHERE dealer_id = $1', [dealerId]);
      } else {
        await manager.query('DELETE FROM marketplace.vehicles');
        await manager.query('DELETE FROM ingestion.upload_jobs');
      }
    });

    console.log('Done.');
  } finally {
    await dataSource.destroy();
  }
}

async function resolveDealerId(dataSource: DataSource, email: string): Promise<string> {
  const rows = await dataSource.query('SELECT id FROM auth.users WHERE email = $1', [email]);
  if (rows.length === 0) {
    throw new Error(`No dealer found with email ${email}`);
  }
  return rows[0].id;
}

async function countAffected(dataSource: DataSource, dealerId?: string) {
  const vehicleWhere = dealerId ? 'WHERE dealer_id = $1' : '';
  const jobWhere = dealerId ? 'WHERE dealer_id = $1' : '';
  const params = dealerId ? [dealerId] : [];

  const [vehicles] = await dataSource.query(
    `SELECT count(*)::int AS n FROM marketplace.vehicles ${vehicleWhere}`,
    params,
  );
  const [vehicleImages] = await dataSource.query(
    `SELECT count(*)::int AS n FROM marketplace.vehicle_images vi
     ${dealerId ? 'JOIN marketplace.vehicles v ON v.id = vi.vehicle_id WHERE v.dealer_id = $1' : ''}`,
    params,
  );
  const [favourites] = await dataSource.query(
    `SELECT count(*)::int AS n FROM marketplace.favourites f
     ${dealerId ? 'JOIN marketplace.vehicles v ON v.id = f.vehicle_id WHERE v.dealer_id = $1' : ''}`,
    params,
  );
  const [uploadJobs] = await dataSource.query(
    `SELECT count(*)::int AS n FROM ingestion.upload_jobs ${jobWhere}`,
    params,
  );
  const [rejectedRecords] = await dataSource.query(
    `SELECT count(*)::int AS n FROM ingestion.rejected_records r
     ${dealerId ? 'JOIN ingestion.upload_jobs j ON j.id = r.upload_job_id WHERE j.dealer_id = $1' : ''}`,
    params,
  );
  const [etlStageLogs] = await dataSource.query(
    `SELECT count(*)::int AS n FROM ingestion.etl_stage_logs l
     ${dealerId ? 'JOIN ingestion.upload_jobs j ON j.id = l.upload_job_id WHERE j.dealer_id = $1' : ''}`,
    params,
  );

  return {
    vehicles: vehicles.n,
    vehicleImages: vehicleImages.n,
    favourites: favourites.n,
    uploadJobs: uploadJobs.n,
    rejectedRecords: rejectedRecords.n,
    etlStageLogs: etlStageLogs.n,
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
