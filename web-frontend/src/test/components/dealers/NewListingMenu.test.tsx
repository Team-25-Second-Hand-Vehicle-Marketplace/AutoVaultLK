import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { NewListingMenu } from '../../../components/dealers/NewListingMenu'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function renderMenu(canBulkUpload: boolean) {
  return render(
    <MemoryRouter initialEntries={['/dealer/listings']}>
      <Routes>
        <Route path="*" element={<><NewListingMenu canBulkUpload={canBulkUpload} /><Where /></>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NewListingMenu', () => {
  it('offers manual listing and bulk upload to a business dealer', async () => {
    renderMenu(true)

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /new listing/i }))

    expect(screen.getByRole('menuitem', { name: /manual listing/i })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /bulk upload/i })).toBeInTheDocument()
  })

  it('goes to the manual listing form when that option is chosen', async () => {
    renderMenu(true)

    await userEvent.click(screen.getByRole('button', { name: /new listing/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /manual listing/i }))

    expect(screen.getByTestId('where')).toHaveTextContent('/dealer/listings/new')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('goes to bulk upload when that option is chosen', async () => {
    renderMenu(true)

    await userEvent.click(screen.getByRole('button', { name: /new listing/i }))
    await userEvent.click(screen.getByRole('menuitem', { name: /bulk upload/i }))

    expect(screen.getByTestId('where')).toHaveTextContent('/dealer/upload')
  })

  it('closes on Escape without navigating', async () => {
    renderMenu(true)

    await userEvent.click(screen.getByRole('button', { name: /new listing/i }))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/dealer/listings')
  })

  it('skips the menu for an individual dealer, who can only add by hand', async () => {
    renderMenu(false)

    await userEvent.click(screen.getByRole('button', { name: /new listing/i }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('where')).toHaveTextContent('/dealer/listings/new')
  })
})
