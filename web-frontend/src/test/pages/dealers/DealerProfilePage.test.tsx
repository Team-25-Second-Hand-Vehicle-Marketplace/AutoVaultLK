import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthContext, type AuthContextValue } from '../../../auth/auth-context'
import { DealerProfileContext } from '../../../pages/dealers/dealer-profile-context'
import { DealerProfilePage } from '../../../pages/dealers/DealerProfilePage'
import { updateMyDealerProfile } from '../../../api/dealer.api'
import { updateMyName } from '../../../api/users.api'
import type { DealerProfile } from '../../../api/dealer.types'
import type { AsyncData } from '../../../hooks/useAsyncData'

vi.mock('../../../api/dealer.api', () => ({ updateMyDealerProfile: vi.fn() }))
vi.mock('../../../api/users.api', () => ({ updateMyName: vi.fn() }))

const updateProfile = vi.mocked(updateMyDealerProfile)
const updateName = vi.mocked(updateMyName)

const DEALER: DealerProfile = {
  userId: 'dealer-1',
  dealerType: 'individual',
  companyName: 'Acme Motors',
  businessRegistrationNumber: '',
  businessAddress: '1 Main St',
  city: 'Colombo',
  contactNumber: '+94701234567',
  verificationStatus: 'VERIFIED',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
}

function renderPage({
  reload = vi.fn(),
  updateUser = vi.fn(),
}: { reload?: () => void; updateUser?: (patch: unknown) => void } = {}) {
  const profile: AsyncData<DealerProfile> = {
    data: DEALER,
    error: null,
    loading: false,
    reload,
    setData: vi.fn(),
  }
  const auth = {
    user: { id: 'dealer-1', email: 'dealer@test.com', name: 'Jane Doe', role: 'DEALER', isActive: true },
    isAuthenticated: true,
    initializing: false,
    login: vi.fn(),
    loginAdmin: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateUser,
  } as unknown as AuthContextValue

  return render(
    <AuthContext.Provider value={auth}>
      <DealerProfileContext.Provider value={profile}>
        <DealerProfilePage />
      </DealerProfileContext.Provider>
    </AuthContext.Provider>,
  )
}

describe('DealerProfilePage', () => {
  beforeEach(() => {
    updateProfile.mockReset()
    updateName.mockReset()
  })

  it('prefills the form from the signed-in user and the dealer profile', async () => {
    renderPage()

    expect(await screen.findByLabelText('Your name')).toHaveValue('Jane Doe')
    expect(screen.getByLabelText('Company name')).toHaveValue('Acme Motors')
    expect(screen.getByLabelText('City')).toHaveValue('Colombo')
    // Individual dealer: no business registration number field.
    expect(screen.queryByLabelText('Business registration number')).not.toBeInTheDocument()
  })

  it('saves the name and the dealer fields, then refreshes both', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    const updateUser = vi.fn()
    const updatedUser = { id: 'dealer-1', email: 'dealer@test.com', name: 'Jane Smith', role: 'DEALER', isActive: true }
    updateName.mockResolvedValue(updatedUser as never)
    updateProfile.mockResolvedValue(DEALER)

    renderPage({ reload, updateUser })

    const nameField = await screen.findByLabelText('Your name')
    await user.clear(nameField)
    await user.type(nameField, 'Jane Smith')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateName).toHaveBeenCalledWith('dealer-1', 'Jane Smith'))
    expect(updateUser).toHaveBeenCalledWith(updatedUser)
    expect(updateProfile).toHaveBeenCalledWith('dealer-1', expect.objectContaining({
      companyName: 'Acme Motors',
      businessAddress: '1 Main St',
      city: 'Colombo',
    }))
    expect(reload).toHaveBeenCalled()
  })

  it('does not save the dealer profile if the name update fails', async () => {
    const user = userEvent.setup()
    updateName.mockRejectedValue(new Error('network down'))

    renderPage()

    const nameField = await screen.findByLabelText('Your name')
    await user.clear(nameField)
    await user.type(nameField, 'Jane Smith')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateName).toHaveBeenCalled())
    expect(updateProfile).not.toHaveBeenCalled()
  })
})
