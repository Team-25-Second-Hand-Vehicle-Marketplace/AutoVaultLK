import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageTransition } from '../../../components/layout/PageTransition'
import { sectionKey } from '../../../components/layout/section-key'

describe('sectionKey', () => {
  it('groups every dealer and admin page into one section so only their content animates', () => {
    expect(sectionKey('/dealer')).toBe('dealer')
    expect(sectionKey('/dealer/listings')).toBe('dealer')
    expect(sectionKey('/dealer/uploads/abc')).toBe('dealer')
    expect(sectionKey('/admin')).toBe('admin')
    expect(sectionKey('/admin/audit-logs')).toBe('admin')
  })

  it('keeps standalone login/register screens as their own pages', () => {
    expect(sectionKey('/dealer/login')).toBe('/dealer/login')
    expect(sectionKey('/dealer/register')).toBe('/dealer/register')
    expect(sectionKey('/admin/login')).toBe('/admin/login')
  })

  it('uses the pathname for buyer and public pages', () => {
    expect(sectionKey('/')).toBe('/')
    expect(sectionKey('/search')).toBe('/search')
    expect(sectionKey('/vehicles/42')).toBe('/vehicles/42')
  })

  it('does not treat lookalike prefixes as dealer/admin sections', () => {
    expect(sectionKey('/dealership')).toBe('/dealership')
    expect(sectionKey('/administrator')).toBe('/administrator')
  })
})

describe('PageTransition', () => {
  it('renders its children', () => {
    render(
      <PageTransition id="/search">
        <p>Search results</p>
      </PageTransition>,
    )
    expect(screen.getByText('Search results')).toBeInTheDocument()
  })

  it('shows the new content after the id changes', async () => {
    const { rerender } = render(
      <PageTransition id="/a">
        <p>Page A</p>
      </PageTransition>,
    )
    rerender(
      <PageTransition id="/b">
        <p>Page B</p>
      </PageTransition>,
    )
    expect(await screen.findByText('Page B')).toBeInTheDocument()
  })
})
