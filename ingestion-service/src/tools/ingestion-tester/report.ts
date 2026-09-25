/**
 * Builds the single-file HTML report for one ingestion-tester run: a summary
 * roll-up, every row's outcome (loaded fields + provenance, or rejection
 * reason), and every image's original-vs-compressed size with an embedded
 * preview of both.
 *
 * Queries mirror run-pipeline.ts's report()/reportPerRow() — same tables,
 * same row-number-to-registration matching — extended with per-image byte
 * sizes (originalBytes tracked by the caller at generation time; processed/
 * thumbnail sizes read back from the object store here) and provenance from
 * vehicles.normalization (groqProvenance()'s shape: {source, confidence,
 * reasoning?} per field).
 */
import type { DataSource } from 'typeorm';
import type { ObjectStore } from '../../infrastructure/ports/object-store.port';
import type { Vehicle } from '../vehicle-generator/vehicle-generator';

export type GeneratedImage = {
  registrationNumber: string;
  fileName: string;
  originalBytes: number;
};

type BuildReportInput = {
  dataSource: DataSource;
  store: ObjectStore;
  jobId: string;
  dealerEmail: string;
  vehicles: Vehicle[];
  generatedImages: GeneratedImage[];
  durationMs: number;
  outputPath: string;
};

type FieldProvenance = { source: string; confidence: number; reasoning?: string };
type Normalization = { fields?: Record<string, FieldProvenance>; rowConfidence?: number };

type LoadedVehicle = {
  id: string;
  registration_number: string | null;
  make: string;
  model: string;
  manufacture_year: number;
  vehicle_type: string;
  condition: string;
  fuel_type: string;
  transmission_type: string;
  color: string | null;
  engine_capacity_cc: number | null;
  owners_count: number | null;
  location_district: string | null;
  status: string;
  needs_manual_review: boolean;
  review_reason: string | null;
  specs: Record<string, unknown>;
  description: string | null;
  has_embedding: boolean;
  normalization: Normalization | null;
};

type VehicleImageRow = {
  vehicle_id: string;
  s3_path: string;
  processed_path: string | null;
  thumbnail_path: string | null;
  is_primary: boolean;
  display_order: number;
};

export async function buildReport(input: BuildReportInput): Promise<void> {
  const { dataSource, store, jobId, dealerEmail, vehicles, generatedImages, durationMs, outputPath } =
    input;

  const [job] = (await dataSource.query(
    `SELECT status, total_records, valid_records, invalid_records
       FROM ingestion.upload_jobs WHERE id = $1`,
    [jobId],
  )) as { status: string; total_records: number; valid_records: number; invalid_records: number }[];

  const stages = (await dataSource.query(
    `SELECT stage, status, count(*) AS chunks
       FROM ingestion.etl_stage_logs WHERE upload_job_id = $1
      GROUP BY stage, status ORDER BY min(started_at)`,
    [jobId],
  )) as { stage: string; status: string; chunks: string }[];

  const rejections = (await dataSource.query(
    `SELECT row_number, reason FROM ingestion.rejected_records WHERE upload_job_id = $1`,
    [jobId],
  )) as { row_number: number; reason: string }[];
  const rejectionByRow = new Map(rejections.map((r) => [r.row_number, r.reason]));

  const loaded = (await dataSource.query(
    `SELECT id, registration_number, make, model, manufacture_year, vehicle_type,
            condition, fuel_type, transmission_type, color, engine_capacity_cc,
            owners_count, location_district, status, needs_manual_review,
            review_reason, specs, description, normalization,
            embedding IS NOT NULL AS has_embedding
       FROM marketplace.vehicles WHERE upload_job_id = $1`,
    [jobId],
  )) as LoadedVehicle[];

  const loadedByRegistration = new Map(
    loaded.filter((v) => v.registration_number).map((v) => [v.registration_number as string, v]),
  );

  const imagesByVehicle = new Map<string, VehicleImageRow[]>();
  if (loaded.length > 0) {
    const images = (await dataSource.query(
      `SELECT vehicle_id, s3_path, processed_path, thumbnail_path, is_primary, display_order
         FROM marketplace.vehicle_images WHERE vehicle_id = ANY($1::uuid[])
        ORDER BY vehicle_id, display_order`,
      [loaded.map((v) => v.id)],
    )) as VehicleImageRow[];

    for (const img of images) {
      const list = imagesByVehicle.get(img.vehicle_id) ?? [];
      list.push(img);
      imagesByVehicle.set(img.vehicle_id, list);
    }
  }

  const originalBytesByRegistrationAndFile = new Map(
    generatedImages.map((img) => [`${img.registrationNumber}::${img.fileName}`, img.originalBytes]),
  );
  const originalTotalByRegistration = new Map<string, number>();
  for (const img of generatedImages) {
    originalTotalByRegistration.set(
      img.registrationNumber,
      (originalTotalByRegistration.get(img.registrationNumber) ?? 0) + img.originalBytes,
    );
  }

  const rowSections: string[] = [];
  let loadedCount = 0;
  let rejectedCount = 0;
  let totalOriginalImageBytes = 0;
  let totalProcessedImageBytes = 0;
  let totalThumbnailImageBytes = 0;
  let imagesMatched = 0;
  let imagesUnmatched = generatedImages.length;

  for (let index = 0; index < vehicles.length; index++) {
    const rowNumber = index + 1;
    const raw = vehicles[index];
    const reg = raw.registration_number;

    const rejectionReason = rejectionByRow.get(rowNumber);
    if (rejectionReason) {
      rejectedCount++;
      rowSections.push(rejectedRowHtml(rowNumber, raw, rejectionReason));
      continue;
    }

    const vehicle = reg ? loadedByRegistration.get(reg) : undefined;
    if (!vehicle) {
      rowSections.push(rejectedRowHtml(rowNumber, raw, 'not found in either rejected_records or vehicles — check row offsets'));
      continue;
    }

    loadedCount++;
    const images = imagesByVehicle.get(vehicle.id) ?? [];

    const imageRows: string[] = [];
    for (const img of images) {
      const fileName = img.s3_path.split('/').pop() ?? img.s3_path;
      const originalBytes = originalBytesByRegistrationAndFile.get(`${reg}::${fileName}`);

      const processedBuffer = img.processed_path ? await safeGet(store, img.processed_path) : null;
      const thumbnailBuffer = img.thumbnail_path ? await safeGet(store, img.thumbnail_path) : null;

      if (originalBytes !== undefined) {
        imagesMatched++;
        imagesUnmatched--;
        totalOriginalImageBytes += originalBytes;
      }
      if (processedBuffer) totalProcessedImageBytes += processedBuffer.byteLength;
      if (thumbnailBuffer) totalThumbnailImageBytes += thumbnailBuffer.byteLength;

      imageRows.push(
        imageComparisonHtml({
          fileName,
          isPrimary: img.is_primary,
          originalBytes,
          processedBytes: processedBuffer?.byteLength,
          thumbnailBytes: thumbnailBuffer?.byteLength,
          processedBase64: processedBuffer?.toString('base64'),
          thumbnailBase64: thumbnailBuffer?.toString('base64'),
        }),
      );
    }

    rowSections.push(loadedRowHtml(rowNumber, vehicle, imageRows));
  }

  const html = pageHtml({
    jobId,
    dealerEmail,
    durationMs,
    job: job ?? { status: 'UNKNOWN', total_records: 0, valid_records: 0, invalid_records: 0 },
    stages,
    loadedCount,
    rejectedCount,
    totalRows: vehicles.length,
    imagesMatched,
    imagesUnmatched,
    totalOriginalImageBytes,
    totalProcessedImageBytes,
    totalThumbnailImageBytes,
    rowSections,
  });

  const { writeFile } = await import('node:fs/promises');
  await writeFile(outputPath, html, 'utf8');
}

async function safeGet(store: ObjectStore, key: string): Promise<Buffer | null> {
  try {
    return await store.get(key);
  } catch {
    return null;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function reductionLabel(originalBytes: number | undefined, newBytes: number | undefined): string {
  if (!originalBytes || newBytes === undefined) return '';
  const pct = ((1 - newBytes / originalBytes) * 100).toFixed(0);
  return ` <span class="reduction">(-${pct}%)</span>`;
}

function rejectedRowHtml(rowNumber: number, raw: Vehicle, reason: string): string {
  return `
    <div class="row row--rejected">
      <div class="row__header">
        <span class="row__number">Row ${rowNumber}</span>
        <span class="row__title">${escapeHtml(raw.make)} ${escapeHtml(raw.model)} (${escapeHtml(raw.registration_number)})</span>
        <span class="badge badge--rejected">REJECTED</span>
      </div>
      <p class="row__reason">${escapeHtml(reason)}</p>
    </div>`;
}

function fieldCell(vehicle: LoadedVehicle, field: string, label: string, value: unknown): string {
  const provenance = vehicle.normalization?.fields?.[field];
  const source = provenance?.source;
  const badge =
    source === 'groq'
      ? `<span class="badge badge--groq" title="${escapeHtml(provenance?.reasoning ?? '')}">groq</span>`
      : source
        ? `<span class="badge badge--${escapeHtml(source)}">${escapeHtml(source)}</span>`
        : '';

  return `<div class="field"><span class="field__label">${label}</span><span class="field__value">${escapeHtml(value ?? '—')}</span>${badge}</div>`;
}

function loadedRowHtml(rowNumber: number, vehicle: LoadedVehicle, imageRows: string[]): string {
  return `
    <div class="row row--loaded">
      <div class="row__header">
        <span class="row__number">Row ${rowNumber}</span>
        <span class="row__title">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)} (${escapeHtml(vehicle.registration_number)})</span>
        <span class="badge badge--loaded">${escapeHtml(vehicle.status)}</span>
        ${vehicle.needs_manual_review ? `<span class="badge badge--review">needs review: ${escapeHtml(vehicle.review_reason)}</span>` : ''}
      </div>
      <div class="fields">
        ${fieldCell(vehicle, 'manufactureYear', 'Year', vehicle.manufacture_year)}
        ${fieldCell(vehicle, 'vehicleType', 'Type', vehicle.vehicle_type)}
        ${fieldCell(vehicle, 'condition', 'Condition', vehicle.condition)}
        ${fieldCell(vehicle, 'fuelType', 'Fuel', vehicle.fuel_type)}
        ${fieldCell(vehicle, 'transmissionType', 'Transmission', vehicle.transmission_type)}
        ${fieldCell(vehicle, 'color', 'Color', vehicle.color)}
        ${fieldCell(vehicle, 'engineCapacityCc', 'Engine (cc)', vehicle.engine_capacity_cc)}
        ${fieldCell(vehicle, 'ownersCount', 'Owners', vehicle.owners_count)}
        ${fieldCell(vehicle, 'locationDistrict', 'District', vehicle.location_district)}
      </div>
      <div class="row__meta">
        Embedding: ${vehicle.has_embedding ? '<span class="ok">present</span>' : '<span class="bad">MISSING</span>'}
        &nbsp;·&nbsp; Specs: <code>${escapeHtml(JSON.stringify(vehicle.specs))}</code>
      </div>
      ${imageRows.length > 0 ? `<div class="images">${imageRows.join('')}</div>` : '<p class="row__no-images">No images matched.</p>'}
    </div>`;
}

function imageComparisonHtml(params: {
  fileName: string;
  isPrimary: boolean;
  originalBytes?: number;
  processedBytes?: number;
  thumbnailBytes?: number;
  processedBase64?: string;
  thumbnailBase64?: string;
}): string {
  const { fileName, isPrimary, originalBytes, processedBytes, thumbnailBytes, processedBase64, thumbnailBase64 } =
    params;

  return `
    <div class="image-compare">
      <div class="image-compare__label">${escapeHtml(fileName)} ${isPrimary ? '<span class="badge badge--primary">primary</span>' : ''}</div>
      <div class="image-compare__row">
        <div class="image-compare__cell">
          <div class="image-compare__caption">Original: ${formatBytes(originalBytes)}</div>
          <div class="image-compare__placeholder">(source file, not stored)</div>
        </div>
        <div class="image-compare__cell">
          <div class="image-compare__caption">Main: ${formatBytes(processedBytes)}${reductionLabel(originalBytes, processedBytes)}</div>
          ${processedBase64 ? `<img src="data:image/jpeg;base64,${processedBase64}" alt="processed" />` : '<div class="image-compare__placeholder">not found</div>'}
        </div>
        <div class="image-compare__cell">
          <div class="image-compare__caption">Thumbnail: ${formatBytes(thumbnailBytes)}${reductionLabel(originalBytes, thumbnailBytes)}</div>
          ${thumbnailBase64 ? `<img src="data:image/jpeg;base64,${thumbnailBase64}" alt="thumbnail" />` : '<div class="image-compare__placeholder">not found</div>'}
        </div>
      </div>
    </div>`;
}

function pageHtml(params: {
  jobId: string;
  dealerEmail: string;
  durationMs: number;
  job: { status: string; total_records: number; valid_records: number; invalid_records: number };
  stages: { stage: string; status: string; chunks: string }[];
  loadedCount: number;
  rejectedCount: number;
  totalRows: number;
  imagesMatched: number;
  imagesUnmatched: number;
  totalOriginalImageBytes: number;
  totalProcessedImageBytes: number;
  totalThumbnailImageBytes: number;
  rowSections: string[];
}): string {
  const {
    jobId,
    dealerEmail,
    durationMs,
    job,
    stages,
    loadedCount,
    rejectedCount,
    totalRows,
    imagesMatched,
    imagesUnmatched,
    totalOriginalImageBytes,
    totalProcessedImageBytes,
    totalThumbnailImageBytes,
    rowSections,
  } = params;

  const stageRows = stages
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.stage)}</td><td class="status-${escapeHtml(s.status.toLowerCase())}">${escapeHtml(s.status)}</td><td>${escapeHtml(s.chunks)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Ingestion test report — ${escapeHtml(jobId)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { font-size: 1.4rem; }
  .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 0.75rem; margin: 1.5rem 0; }
  .summary__card { border: 1px solid #ccc4; border-radius: 8px; padding: 0.75rem; }
  .summary__card strong { display: block; font-size: 1.4rem; }
  .notice { background: #fff3cd; border: 1px solid #ffe69c; border-radius: 8px; padding: 0.75rem 1rem; margin: 1rem 0; }
  table { border-collapse: collapse; margin: 1rem 0; width: 100%; }
  th, td { text-align: left; padding: 0.35rem 0.6rem; border-bottom: 1px solid #ccc4; }
  .status-succeeded { color: #1a7f37; } .status-degraded { color: #9a6700; } .status-failed { color: #cf222e; } .status-skipped { color: #6e7781; }
  .row { border: 1px solid #ccc4; border-radius: 8px; padding: 0.9rem 1.1rem; margin: 0.9rem 0; }
  .row--rejected { border-left: 4px solid #cf222e; }
  .row--loaded { border-left: 4px solid #1a7f37; }
  .row__header { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; }
  .row__number { font-weight: 600; opacity: 0.6; }
  .row__title { font-weight: 600; }
  .row__reason { color: #cf222e; margin: 0; }
  .row__meta { margin-top: 0.5rem; font-size: 0.9rem; opacity: 0.85; }
  .row__no-images { opacity: 0.6; font-size: 0.9rem; }
  .badge { font-size: 0.72rem; padding: 0.1rem 0.5rem; border-radius: 999px; text-transform: uppercase; letter-spacing: 0.02em; }
  .badge--rejected { background: #ffebe9; color: #cf222e; }
  .badge--loaded { background: #dafbe1; color: #1a7f37; }
  .badge--review { background: #fff3cd; color: #9a6700; }
  .badge--groq { background: #ddf4ff; color: #0969da; cursor: help; }
  .badge--rule, .badge--dictionary { background: #eee; color: #555; }
  .badge--primary { background: #e6e6fa; color: #4b0082; }
  .fields { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 0.4rem 1rem; }
  .field { display: flex; flex-direction: column; gap: 0.15rem; font-size: 0.85rem; }
  .field__label { opacity: 0.6; font-size: 0.72rem; text-transform: uppercase; }
  .field__value { font-weight: 500; }
  .ok { color: #1a7f37; } .bad { color: #cf222e; font-weight: 600; }
  .images { display: flex; flex-direction: column; gap: 0.6rem; margin-top: 0.75rem; border-top: 1px dashed #ccc4; padding-top: 0.6rem; }
  .image-compare__label { font-size: 0.85rem; margin-bottom: 0.3rem; }
  .image-compare__row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
  .image-compare__cell { flex: 1; min-width: 160px; }
  .image-compare__caption { font-size: 0.75rem; opacity: 0.75; margin-bottom: 0.25rem; }
  .image-compare__placeholder { font-size: 0.75rem; opacity: 0.5; border: 1px dashed #ccc4; border-radius: 4px; padding: 1.5rem 0.5rem; text-align: center; }
  .reduction { color: #1a7f37; font-weight: 600; }
  img { max-width: 100%; border-radius: 4px; display: block; }
  @media (prefers-color-scheme: dark) { body { background: #0d1117; color: #e6edf3; } .summary__card, .row { border-color: #30363d; } }
</style>
</head>
<body>
  <h1>Ingestion test report</h1>
  <p>Job <code>${escapeHtml(jobId)}</code> · dealer <code>${escapeHtml(dealerEmail)}</code> · finished in ${durationMs}ms</p>

  <div class="notice">
    Vehicles land as <strong>PENDING_REVIEW</strong>, exactly like a real dealer bulk upload.
    They will not appear in marketplace search or the public listing feed until approved —
    open <strong>My Listings</strong> as this dealer and click Approve, or query the DB directly,
    before expecting to see them live.
  </div>

  <div class="summary">
    <div class="summary__card"><strong>${totalRows}</strong>total rows</div>
    <div class="summary__card"><strong>${loadedCount}</strong>loaded</div>
    <div class="summary__card"><strong>${rejectedCount}</strong>rejected</div>
    <div class="summary__card"><strong>${imagesMatched}</strong>images matched</div>
    <div class="summary__card"><strong>${imagesUnmatched}</strong>images unmatched</div>
    <div class="summary__card"><strong>${formatBytes(totalOriginalImageBytes)}</strong>original size</div>
    <div class="summary__card"><strong>${formatBytes(totalProcessedImageBytes)}</strong>compressed (main)</div>
    <div class="summary__card"><strong>${formatBytes(totalThumbnailImageBytes)}</strong>compressed (thumb)</div>
  </div>

  <h2>Stages</h2>
  <table>
    <thead><tr><th>Stage</th><th>Status</th><th>Chunks</th></tr></thead>
    <tbody>${stageRows}</tbody>
  </table>
  <p>Job status: <strong>${escapeHtml(job.status)}</strong> — ${job.valid_records} valid / ${job.invalid_records} invalid of ${job.total_records}</p>

  <h2>Rows</h2>
  ${rowSections.join('')}
</body>
</html>`;
}
