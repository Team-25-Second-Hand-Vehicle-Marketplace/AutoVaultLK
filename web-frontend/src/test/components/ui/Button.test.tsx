import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../../../components/ui/Button'

describe('Button', () => {
  it('defaults to the primary variant and type="button"', () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole('button', { name: 'Click me' })
    expect(button).toHaveClass('button', 'button--primary')
    expect(button).toHaveAttribute('type', 'button')
  })

  it('applies the requested variant and size classes', () => {
    render(<Button variant="danger" size="sm">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveClass('button--danger', 'button--sm')
  })

  it('applies the block class when block is set', () => {
    render(<Button block>Full width</Button>)
    expect(screen.getByRole('button')).toHaveClass('button--block')
  })

  it('merges a custom className', () => {
    render(<Button className="my-extra-class">Styled</Button>)
    expect(screen.getByRole('button')).toHaveClass('my-extra-class')
  })

  it('fires onClick when clicked', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick}>Submit</Button>)

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('does not fire onClick when disabled', async () => {
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<Button onClick={onClick} disabled>Submit</Button>)

    await user.click(screen.getByRole('button', { name: 'Submit' }))

    expect(onClick).not.toHaveBeenCalled()
  })
})
