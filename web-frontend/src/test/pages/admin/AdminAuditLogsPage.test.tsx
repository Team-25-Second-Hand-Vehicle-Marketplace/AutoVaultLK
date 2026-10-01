import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AdminAuditLogsPage } from '../../../pages/admin/AdminAuditLogsPage'
import { searchAuditLogs } from '../../../api/admin.api'

vi.mock('../../../api/admin.api', () => ({ searchAuditLogs: vi.fn() }))

const search = vi.mocked(searchAuditLogs)

const LOG = {
  id: 'log-1',
  action: 'DEALER_APPROVED',
  entityType: 'DEALER_PROFILE',
  entityId: 'abcdef12-0000-0000-0000-000000000000',
  actorId: 'actor-1',
  ipAddress: '10.0.0.1',
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('AdminAuditLogsPage', () => {
  beforeEach(() => {
    search.mockReset()
    search.mockResolvedValue([LOG] as never)
  })

  it('shows action and entity names as words, without underscores', async () => {
    render(<AdminAuditLogsPage />)

    expect(await screen.findByText('DEALER APPROVED')).toBeInTheDocument()
    expect(screen.getByText(/DEALER PROFILE/)).toBeInTheDocument()
    expect(screen.queryByText(/DEALER_APPROVED/)).not.toBeInTheDocument()
  })

  it('does not suggest an underscored action name in the search box', async () => {
    render(<AdminAuditLogsPage />)
    await screen.findByText('DEALER APPROVED')

    expect(screen.getByPlaceholderText('e.g. Dealer approved')).toBeInTheDocument()
  })

  it('searches with the stored form when the action is typed as plain words', async () => {
    render(<AdminAuditLogsPage />)
    await screen.findByText('DEALER APPROVED')

    await userEvent.type(screen.getByPlaceholderText('e.g. Dealer approved'), 'dealer approved')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() =>
      expect(search).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'DEALER_APPROVED' }),
        expect.anything(),
      ),
    )
  })
})
