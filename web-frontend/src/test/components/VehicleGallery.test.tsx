import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VehicleGallery } from '../../components/search/VehicleGallery'

const PHOTOS = ['a.jpg', 'b.jpg', 'c.jpg']

const mainSrc = () => (screen.getByRole('img', { name: /photo \d of \d/ }) as HTMLImageElement).src

describe('VehicleGallery', () => {
  it('shows the first photo and a thumbnail for every photo, the first included', () => {
    render(<VehicleGallery images={PHOTOS} alt="Toyota Aqua" />)

    expect(mainSrc()).toContain('a.jpg')
    expect(screen.getAllByRole('button', { name: /Show photo/ })).toHaveLength(3)
  })

  it('swaps the main photo when a thumbnail is clicked', async () => {
    const user = userEvent.setup()
    render(<VehicleGallery images={PHOTOS} alt="Toyota Aqua" />)

    await user.click(screen.getByRole('button', { name: 'Show photo 3 of 3' }))

    expect(mainSrc()).toContain('c.jpg')
    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('wraps around with the next / previous arrows', async () => {
    const user = userEvent.setup()
    render(<VehicleGallery images={PHOTOS} alt="Toyota Aqua" />)

    await user.click(screen.getByRole('button', { name: 'Previous photo' }))
    expect(mainSrc()).toContain('c.jpg')

    await user.click(screen.getByRole('button', { name: 'Next photo' }))
    expect(mainSrc()).toContain('a.jpg')
  })

  it('moves with the arrow keys', async () => {
    const user = userEvent.setup()
    render(<VehicleGallery images={PHOTOS} alt="Toyota Aqua" />)

    screen.getByRole('group').focus()
    await user.keyboard('{ArrowRight}')
    expect(mainSrc()).toContain('b.jpg')
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(mainSrc()).toContain('c.jpg')
  })

  it('shows no controls for a single photo', () => {
    render(<VehicleGallery images={['only.jpg']} alt="Toyota Aqua" />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing without photos', () => {
    const { container } = render(<VehicleGallery images={[]} alt="Toyota Aqua" />)
    expect(container).toBeEmptyDOMElement()
  })
})
