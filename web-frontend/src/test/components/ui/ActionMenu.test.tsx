import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ActionMenu } from '../../../components/ui/ActionMenu'

describe('ActionMenu', () => {
  it('shows no items until the trigger is clicked', () => {
    render(<ActionMenu items={[{ label: 'Edit', onClick: vi.fn() }]} />)

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('opens the panel and lists every item on click', async () => {
    const user = userEvent.setup()
    render(
      <ActionMenu
        items={[
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Delete', onClick: vi.fn(), danger: true },
        ]}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))

    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('runs the item action and closes the menu on click', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<ActionMenu items={[{ label: 'Edit', onClick: onEdit }]} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('closes when clicking outside', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <ActionMenu items={[{ label: 'Edit', onClick: vi.fn() }]} />
        <button type="button">Outside</button>
      </div>,
    )

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument()
  })

  it('does not run a disabled item', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    render(<ActionMenu items={[{ label: 'Deleting…', onClick: onDelete, disabled: true }]} />)

    await user.click(screen.getByRole('button', { name: 'More actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Deleting…' }))

    expect(onDelete).not.toHaveBeenCalled()
  })
})
