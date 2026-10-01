import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RadioFacetGroup } from '../../../components/search/RadioFacetGroup'

const OPTIONS = ['FWD', 'RWD', 'AWD'] as const

describe('RadioFacetGroup', () => {
  it('selects an option when it is clicked', async () => {
    const onChange = vi.fn()
    render(<RadioFacetGroup label="Drive Type" options={OPTIONS} selected={undefined} onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('RWD'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('RWD')
  })

  it('deselects the selected option when it is clicked again', async () => {
    const onChange = vi.fn()
    render(<RadioFacetGroup label="Drive Type" options={OPTIONS} selected="FWD" onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('FWD'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  it('switches to another option without clearing in between', async () => {
    const onChange = vi.fn()
    render(<RadioFacetGroup label="Drive Type" options={OPTIONS} selected="FWD" onChange={onChange} />)

    await userEvent.click(screen.getByLabelText('AWD'))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('AWD')
  })
})
