import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RejectionsReport } from '../../../components/dealers/RejectionsReport'
import type { RejectedRecord } from '../../../api/ingestion.types'

/**
 * FR-57. What this guards is that the dealer can identify *which* rows failed
 * and why — the page previously showed only a count and a guess at the cause.
 */
const row = (overrides: Partial<RejectedRecord> = {}): RejectedRecord => ({
  rowNumber: 17,
  stage: 'VALIDATE_ROWS',
  reason: 'manufacture_year 1972 is outside the accepted range',
  rawData: { registration_number: 'CAB-1234', year: '1972' },
  rawDataTruncated: false,
  createdAt: '2026-09-01T10:03:00.000Z',
  ...overrides,
})

const props = {
  rows: [row()],
  total: 1,
  skippedCount: 1,
  loading: false,
  error: null,
}

describe('RejectionsReport', () => {
  it('shows the row number, the reason and the submitted values', () => {
    render(<RejectionsReport {...props} />)

    expect(screen.getByText('17')).toBeInTheDocument()
    expect(
      screen.getByText('manufacture_year 1972 is outside the accepted range'),
    ).toBeInTheDocument()
    expect(screen.getByText('CAB-1234')).toBeInTheDocument()
  })

  // Stage names are internal pipeline vocabulary; a dealer has no reason to
  // know what GROQ_NORMALIZE is.
  it('translates the pipeline stage into dealer-facing wording', () => {
    render(<RejectionsReport {...props} rows={[row({ stage: 'GROQ_NORMALIZE' })]} />)

    expect(screen.getByText('Could not read a value')).toBeInTheDocument()
    expect(screen.queryByText('GROQ_NORMALIZE')).not.toBeInTheDocument()
  })

  // Row 0 is the whole-file rejection, not row zero of the file.
  it('labels a whole-file rejection rather than showing row 0', () => {
    render(
      <RejectionsReport
        {...props}
        rows={[row({ rowNumber: 0, stage: 'VALIDATE_FILE', reason: 'missing required column: make' })]}
      />,
    )

    expect(screen.getByText('Whole file')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('tells the dealer when more rows were skipped than are shown', () => {
    render(<RejectionsReport {...props} total={120} skippedCount={120} />)

    expect(screen.getByText(/Showing the first 1 of 120/)).toBeInTheDocument()
  })

  it('omits the truncation note when every page is shown', () => {
    render(<RejectionsReport {...props} />)

    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument()
  })

  // The counts and the detail rows are written by different pipeline stages,
  // so a count with no detail is possible and must not render an empty table.
  it('explains an empty report rather than showing a bare heading', () => {
    render(<RejectionsReport {...props} rows={[]} total={0} skippedCount={6} />)

    expect(
      screen.getByText('No details were recorded for the skipped rows.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('surfaces a failed fetch without hiding the skipped count', () => {
    render(
      <RejectionsReport
        {...props}
        rows={[]}
        error="Could not load the skipped rows."
        skippedCount={6}
      />,
    )

    expect(screen.getByText('Could not load the skipped rows.')).toBeInTheDocument()
    expect(screen.getByText(/6 rows/)).toBeInTheDocument()
  })

  it('flags that raw data was trimmed', () => {
    render(<RejectionsReport {...props} rows={[row({ rawDataTruncated: true })]} />)

    expect(screen.getByText(/more columns not shown/)).toBeInTheDocument()
  })

  it('pluralises the skipped-row count', () => {
    const { rerender } = render(<RejectionsReport {...props} skippedCount={1} />)
    expect(screen.getByText(/1 row could not be loaded/)).toBeInTheDocument()

    rerender(<RejectionsReport {...props} skippedCount={4} />)
    expect(screen.getByText(/4 rows could not be loaded/)).toBeInTheDocument()
  })
})
