import type { EtlStage, RejectedRecord } from '../../api/ingestion.types'
import { ErrorBanner } from '../ui/ErrorBanner'

/**
 * FR-57: the row-level half of the dealer's upload report.
 *
 * This replaces a paragraph that *guessed* at why rows failed ("usually a
 * missing make or model…"). A dealer cannot act on a guess: with 6 skipped
 * rows out of 40 they had no way to tell which 6, so the only safe response
 * was to re-check the whole file by hand.
 */

/**
 * Stage names are internal pipeline vocabulary — a dealer has no reason to
 * know what GROQ_NORMALIZE is. These say what failed in the dealer's terms.
 */
const STAGE_COPY: Record<EtlStage, string> = {
  VALIDATE_FILE: 'File format',
  SPLIT_CHUNKS: 'File format',
  PARSE_NORMALIZE: 'Could not read a value',
  GROQ_NORMALIZE: 'Could not read a value',
  VALIDATE_ROWS: 'Invalid value',
  ENRICH: 'Could not match details',
  EMBED: 'Indexing',
  LOAD: 'Saving',
  PROCESS_IMAGES: 'Photo',
  AGGREGATE: 'Processing',
  NOTIFY: 'Processing',
}

type Props = {
  rows: RejectedRecord[]
  /** Rejections recorded for the job, which may exceed the rows on this page. */
  total: number
  /** invalid_records from the job itself — the number the tiles above show. */
  skippedCount: number
  loading: boolean
  error: string | null
}

export function RejectionsReport({ rows, total, skippedCount, loading, error }: Props) {
  return (
    <section className="upload-card">
      <h2>Rows that were skipped</h2>

      <p className="dealer-muted">
        {skippedCount} row{skippedCount === 1 ? '' : 's'} could not be loaded. Correct
        {skippedCount === 1 ? ' it' : ' them'} in your file and upload just those rows —
        the rows that already loaded are unaffected.
      </p>

      {error && <ErrorBanner message={error} />}

      {loading && (
        <p className="dealer-muted" role="status">
          Loading skipped rows…
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        // The counts and the detail rows are written by different pipeline
        // stages, so a count with no detail is possible; saying so is better
        // than rendering an empty table under a "6 rows skipped" heading.
        <p className="dealer-muted">
          No details were recorded for the skipped rows.
        </p>
      )}

      {rows.length > 0 && (
        <>
          <div className="rejections-table__wrap">
            <table className="rejections-table">
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col">Problem</th>
                  <th scope="col">What we received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={`${row.stage}-${row.rowNumber}`}>
                    <th scope="row">
                      {/* Row 0 is the whole-file rejection, not a row in the file. */}
                      {row.rowNumber === 0 ? 'Whole file' : row.rowNumber}
                    </th>
                    <td>
                      <span className="rejections-table__stage">
                        {STAGE_COPY[row.stage] ?? 'Problem'}
                      </span>
                      <span className="rejections-table__reason">{row.reason}</span>
                    </td>
                    <td>
                      <RawData data={row.rawData} truncated={row.rawDataTruncated} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {total > rows.length && (
            <p className="dealer-muted">
              Showing the first {rows.length} of {total} skipped rows.
            </p>
          )}
        </>
      )}
    </section>
  )
}

function RawData({
  data,
  truncated,
}: {
  data: Record<string, unknown>
  truncated: boolean
}) {
  const entries = Object.entries(data).filter(
    ([, value]) => value !== null && value !== undefined && value !== '',
  )

  if (entries.length === 0) {
    return <span className="dealer-muted">—</span>
  }

  return (
    <dl className="rejections-raw">
      {entries.map(([key, value]) => (
        <div key={key} className="rejections-raw__pair">
          <dt>{key}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
      {truncated && (
        <div className="rejections-raw__pair">
          <dd className="dealer-muted">…more columns not shown</dd>
        </div>
      )}
    </dl>
  )
}
