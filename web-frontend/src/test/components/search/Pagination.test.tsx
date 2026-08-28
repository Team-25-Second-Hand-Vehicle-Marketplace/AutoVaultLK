import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from '../../../components/search/Pagination'

describe('Pagination', () => {
  it('renders nothing when there is one page or fewer', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a button for every page when within the visible window', () => {
    render(<Pagination page={1} totalPages={5} onChange={vi.fn()} />)
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: String(n) })).toBeInTheDocument()
    }
  })

  it('marks the current page as active with aria-current', () => {
    render(<Pagination page={3} totalPages={5} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: '3' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: '2' })).not.toHaveAttribute('aria-current')
  })

  it('disables Previous on the first page and Next on the last page', () => {
    render(<Pagination page={1} totalPages={3} onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Next/ })).not.toBeDisabled()
  })

  it('caps the visible window at 7 pages and centers around the current page', () => {
    render(<Pagination page={10} totalPages={20} onChange={vi.fn()} />)
    const pageButtons = screen
      .getAllByRole('button')
      .filter((btn) => /^\d+$/.test(btn.textContent ?? ''))
    expect(pageButtons).toHaveLength(7)
    expect(pageButtons.map((b) => b.textContent)).toContain('10')
  })

  it('calls onChange with the clicked page number', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Pagination page={1} totalPages={5} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: '3' }))

    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('calls onChange with page - 1 when Previous is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Pagination page={3} totalPages={5} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Previous/ }))

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('calls onChange with page + 1 when Next is clicked', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<Pagination page={3} totalPages={5} onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: /Next/ }))

    expect(onChange).toHaveBeenCalledWith(4)
  })
})
