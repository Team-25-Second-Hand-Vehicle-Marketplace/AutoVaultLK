import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  NormalizationDetails,
  NormalizationSummary,
} from '../../../components/dealers/NormalizationBadge'
import type { VehicleNormalization } from '../../../api/listings.types'

/**
 * FR-42.1: the dealer's review interface must show which fields on a
 * PENDING_REVIEW listing were inferred, and the model's stated reasoning.
 * What these guard is that a dealer reviewing a listing can actually see that
 * information, not just that the data reaches the component.
 */

const normalization = (
  overrides: Partial<VehicleNormalization['fields']> = {},
): VehicleNormalization => ({
  fields: {
    make: { source: 'dictionary', confidence: 0.8 },
    model: { source: 'groq', confidence: 0.8, reasoning: 'Corrected misspelling.' },
    ...overrides,
  },
  rowConfidence: 0.8,
})

describe('NormalizationSummary', () => {
  it('renders nothing for a listing with no normalization', () => {
    const { container } = render(<NormalizationSummary normalization={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  // A manually-created listing and one predating migration 29000 both arrive
  // this way; neither has anything to review.
  it('renders nothing for an empty field map', () => {
    const { container } = render(
      <NormalizationSummary normalization={{ fields: {}, rowConfidence: 1 }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('counts AI-corrected fields', () => {
    render(<NormalizationSummary normalization={normalization()} />)

    expect(screen.getByText('1 AI-corrected')).toBeInTheDocument()
  })

  it('flags low-confidence fields regardless of source', () => {
    render(
      <NormalizationSummary
        normalization={normalization({
          price: { source: 'rule', confidence: 0.4 },
        })}
      />,
    )

    expect(screen.getByText('1 low confidence')).toBeInTheDocument()
  })

  it('omits the AI pill when nothing was Groq-sourced', () => {
    render(
      <NormalizationSummary
        normalization={{
          fields: { make: { source: 'dictionary', confidence: 1 } },
          rowConfidence: 1,
        }}
      />,
    )

    expect(screen.queryByText(/AI-corrected/)).not.toBeInTheDocument()
  })
})

describe('NormalizationDetails', () => {
  it('renders nothing for a listing with no normalization', () => {
    const { container } = render(<NormalizationDetails normalization={null} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('starts collapsed', () => {
    render(<NormalizationDetails normalization={normalization()} />)

    expect(screen.queryByText('Corrected misspelling.')).not.toBeInTheDocument()
    expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
  })

  it('shows each field, its source and reasoning once expanded', async () => {
    const user = userEvent.setup()
    render(<NormalizationDetails normalization={normalization()} />)

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('AI-corrected')).toBeInTheDocument()
    expect(screen.getByText('Corrected misspelling.')).toBeInTheDocument()
  })

  it('shows a field with no reasoning without an empty explanation', async () => {
    const user = userEvent.setup()
    render(<NormalizationDetails normalization={normalization()} />)

    await user.click(screen.getByRole('button'))

    // make has no reasoning — dictionary matches have nothing to explain.
    const makeRow = screen.getByText('Make').closest('div')
    expect(makeRow?.textContent).not.toMatch(/undefined|null/)
  })

  // The weakest match is the one a dealer most needs to see; it should not be
  // scrolled past a screenful of confident ones.
  it('orders fields weakest confidence first', async () => {
    const user = userEvent.setup()
    render(
      <NormalizationDetails
        normalization={{
          fields: {
            make: { source: 'dictionary', confidence: 1 },
            model: { source: 'dictionary', confidence: 0.3 },
            price: { source: 'rule', confidence: 0.6 },
          },
          rowConfidence: 0.3,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))

    // The <dt> renders label + source badge + (optional) flag as one text
    // node, so match on the field name appearing anywhere within it rather
    // than an exact string.
    const dtNodes = document.querySelectorAll('.normalization-field__name')
    const order = Array.from(dtNodes).map((el) =>
      ['Make', 'Model', 'Price'].find((label) => el.textContent?.startsWith(label)),
    )
    expect(order).toEqual(['Model', 'Price', 'Make'])
  })

  it('flags a field below the low-confidence threshold', async () => {
    const user = userEvent.setup()
    render(
      <NormalizationDetails
        normalization={{
          fields: { fuelType: { source: 'rule', confidence: 0.4 } },
          rowConfidence: 0.4,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('Low confidence')).toBeInTheDocument()
  })

  it('does not flag a confident field', async () => {
    const user = userEvent.setup()
    render(
      <NormalizationDetails
        normalization={{
          fields: { fuelType: { source: 'rule', confidence: 1 } },
          rowConfidence: 1,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.queryByText('Low confidence')).not.toBeInTheDocument()
  })

  it('falls back to the raw field name for one it does not have a label for', async () => {
    const user = userEvent.setup()
    render(
      <NormalizationDetails
        normalization={{
          fields: { someNewField: { source: 'raw', confidence: 1 } } as never,
          rowConfidence: 1,
        }}
      />,
    )

    await user.click(screen.getByRole('button'))

    expect(screen.getByText('someNewField')).toBeInTheDocument()
  })

  it('collapses again on a second click', async () => {
    const user = userEvent.setup()
    render(<NormalizationDetails normalization={normalization()} />)

    const toggle = screen.getByRole('button')
    await user.click(toggle)
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Corrected misspelling.')).not.toBeInTheDocument()
  })
})
