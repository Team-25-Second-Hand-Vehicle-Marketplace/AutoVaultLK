import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../../../components/ui/Modal'

function renderModal(onClose = vi.fn(), open = true) {
  render(
    <Modal open={open} onClose={onClose} title="Details" footer={<button>Save</button>}>
      <p>Body text</p>
    </Modal>,
  )
  return onClose
}

describe('Modal', () => {
  it('renders nothing while closed', () => {
    renderModal(vi.fn(), false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('is an accessible, labelled dialog', () => {
    renderModal()
    const dialog = screen.getByRole('dialog', { name: 'Details' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Body text')).toBeInTheDocument()
  })

  it('stops the smooth-scroll library from scrolling the page behind it', () => {
    renderModal()
    expect(screen.getByRole('dialog').parentElement).toHaveAttribute('data-lenis-prevent')
  })

  it('moves focus into the dialog when it opens', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('closes on Escape', async () => {
    const onClose = renderModal()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes from the X button', async () => {
    const onClose = renderModal()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes when the backdrop is clicked, but not when the dialog itself is', async () => {
    const onClose = renderModal()

    await userEvent.click(screen.getByText('Body text'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('dialog').parentElement as HTMLElement)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps Tab focus inside the dialog', async () => {
    renderModal()
    const close = screen.getByRole('button', { name: 'Close' })
    const save = screen.getByRole('button', { name: 'Save' })

    save.focus()
    await userEvent.tab()
    expect(close).toHaveFocus()

    await userEvent.tab({ shift: true })
    expect(save).toHaveFocus()
  })

  it('locks page scroll while open and restores it on close', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = render(
      <Modal open onClose={vi.fn()} title="Details">
        <p>x</p>
      </Modal>,
    )
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
  })
})
