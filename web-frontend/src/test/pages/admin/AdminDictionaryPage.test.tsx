import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminDictionaryPage } from '../../../pages/admin/AdminDictionaryPage'
import {
  addDictionaryAlias,
  addDictionaryMake,
  dismissDictionaryCandidate,
  listDictionaryCandidates,
} from '../../../api/admin.api'
import type { DictionaryCandidate } from '../../../api/admin.types'

vi.mock('../../../api/admin.api', async () => {
  const actual = await vi.importActual<typeof import('../../../api/admin.api')>(
    '../../../api/admin.api',
  )
  return {
    ...actual,
    listDictionaryCandidates: vi.fn(),
    addDictionaryMake: vi.fn(),
    addDictionaryAlias: vi.fn(),
    dismissDictionaryCandidate: vi.fn(),
  }
})

const mockList = vi.mocked(listDictionaryCandidates)
const mockAddMake = vi.mocked(addDictionaryMake)
const mockAddAlias = vi.mocked(addDictionaryAlias)
const mockDismiss = vi.mocked(dismissDictionaryCandidate)

const candidate = (overrides: Partial<DictionaryCandidate> = {}): DictionaryCandidate => ({
  rawValue: 'byd',
  displayValue: 'BYD',
  occurrences: 3,
  dealerCount: 2,
  samples: [{ make: 'BYD', model: 'Seal', description: 'EV sedan' }],
  closestMatch: null,
  ...overrides,
})

describe('AdminDictionaryPage', () => {
  beforeEach(() => {
    mockList.mockReset()
    mockAddMake.mockReset()
    mockAddAlias.mockReset()
    mockDismiss.mockReset()
  })

  it('shows an empty state when nothing needs review', async () => {
    mockList.mockResolvedValue([])

    render(<AdminDictionaryPage />)

    expect(
      await screen.findByText(/Nothing to review/),
    ).toBeInTheDocument()
  })

  it('shows "No close match" for a genuinely new make', async () => {
    mockList.mockResolvedValue([candidate()])

    render(<AdminDictionaryPage />)

    expect(await screen.findByText('BYD')).toBeInTheDocument()
    expect(screen.getByText('No close match')).toBeInTheDocument()
    expect(screen.getByText('3 rows')).toBeInTheDocument()
    expect(screen.getByText('2 dealers')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add as alias' })).not.toBeInTheDocument()
  })

  it('shows the closest match and an alias action when one exists', async () => {
    mockList.mockResolvedValue([
      candidate({
        displayValue: 'Toyott',
        closestMatch: { id: 'dict-toyota', canonicalValue: 'Toyota', score: 0.62 },
      }),
    ])

    render(<AdminDictionaryPage />)

    expect(await screen.findByText('Toyota (62%)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add as alias' })).toBeInTheDocument()
  })

  it('adds a new make and removes the row on confirm', async () => {
    mockList.mockResolvedValue([candidate()])
    mockAddMake.mockResolvedValue(undefined)
    vi.spyOn(window, 'prompt').mockReturnValue('BYD')
    const user = userEvent.setup()

    render(<AdminDictionaryPage />)
    await screen.findByText('BYD')

    await user.click(screen.getByRole('button', { name: 'Add as new make' }))

    expect(mockAddMake).toHaveBeenCalledWith('byd', 'BYD')
    expect(await screen.findByText(/Nothing to review/)).toBeInTheDocument()
  })

  it('does not call addDictionaryMake when the prompt is cancelled', async () => {
    mockList.mockResolvedValue([candidate()])
    vi.spyOn(window, 'prompt').mockReturnValue(null)
    const user = userEvent.setup()

    render(<AdminDictionaryPage />)
    await screen.findByText('BYD')

    await user.click(screen.getByRole('button', { name: 'Add as new make' }))

    expect(mockAddMake).not.toHaveBeenCalled()
  })

  it('adds an alias and removes the row on confirm', async () => {
    mockList.mockResolvedValue([
      candidate({
        displayValue: 'Toyott',
        closestMatch: { id: 'dict-toyota', canonicalValue: 'Toyota', score: 0.62 },
      }),
    ])
    mockAddAlias.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = userEvent.setup()

    render(<AdminDictionaryPage />)
    await screen.findByText('Toyott')

    await user.click(screen.getByRole('button', { name: 'Add as alias' }))

    expect(mockAddAlias).toHaveBeenCalledWith('byd', 'Toyott', 'dict-toyota')
    expect(await screen.findByText(/Nothing to review/)).toBeInTheDocument()
  })

  it('dismisses a candidate and removes the row', async () => {
    mockList.mockResolvedValue([candidate()])
    mockDismiss.mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<AdminDictionaryPage />)
    await screen.findByText('BYD')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))

    expect(mockDismiss).toHaveBeenCalledWith('byd')
    expect(await screen.findByText(/Nothing to review/)).toBeInTheDocument()
  })

  it('shows an error banner when the list request fails', async () => {
    mockList.mockRejectedValue(new Error('network down'))

    render(<AdminDictionaryPage />)

    expect(await screen.findByText('Could not load unresolved makes.')).toBeInTheDocument()
  })
})
