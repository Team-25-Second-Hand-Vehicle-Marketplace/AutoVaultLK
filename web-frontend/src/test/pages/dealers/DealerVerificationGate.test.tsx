import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DealerVerificationGate } from '../../../pages/dealers/DealerVerificationGate'
import { resubmitMyDealerProfile } from '../../../api/dealer.api'
import { uploadVerificationDocument } from '../../../api/auth.api'
import type { DealerProfile } from '../../../api/dealer.types'
import type { AsyncData } from '../../../hooks/useAsyncData'

vi.mock('../../../api/dealer.api', () => ({ resubmitMyDealerProfile: vi.fn() }))
vi.mock('../../../api/auth.api', () => ({ uploadVerificationDocument: vi.fn() }))

const resubmit = vi.mocked(resubmitMyDealerProfile)
const uploadDoc = vi.mocked(uploadVerificationDocument)

function asyncData(dealer: DealerProfile, reload = vi.fn()): AsyncData<DealerProfile> {
  return { data: dealer, error: null, loading: false, reload }
}

const BASE_DEALER = {
  userId: 'dealer-1',
  companyName: 'Acme Motors',
  businessRegistrationNumber: 'BR-1',
  businessAddress: '1 Main St',
  city: 'Colombo',
  contactNumber: '+94701234567',
  rejectionReason: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as const

describe('DealerVerificationGate', () => {
  beforeEach(() => {
    resubmit.mockReset()
    uploadDoc.mockReset()
  })

  it('shows a pending message with no form for a PENDING dealer', () => {
    const dealer: DealerProfile = {
      ...BASE_DEALER,
      dealerType: 'individual',
      verificationStatus: 'PENDING',
    }
    render(<DealerVerificationGate profile={asyncData(dealer)} />)

    expect(screen.getByText('Verification pending')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /resubmit/i })).not.toBeInTheDocument()
  })

  it('shows the rejection reason and a resubmit form for a REJECTED dealer', () => {
    const dealer: DealerProfile = {
      ...BASE_DEALER,
      dealerType: 'individual',
      verificationStatus: 'REJECTED',
      rejectionReason: 'NIC image was unreadable',
    }
    render(<DealerVerificationGate profile={asyncData(dealer)} />)

    expect(screen.getByText('NIC image was unreadable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resubmit for review/i })).toBeInTheDocument()
    // Individual dealers get an NIC field, not a registration number.
    expect(screen.getByLabelText('NIC number')).toBeInTheDocument()
    expect(screen.queryByLabelText('Business registration number')).not.toBeInTheDocument()
  })

  it('resubmits an individual dealer with their NIC and reloads the profile', async () => {
    const user = userEvent.setup()
    const reload = vi.fn()
    const dealer: DealerProfile = {
      ...BASE_DEALER,
      dealerType: 'individual',
      verificationStatus: 'REJECTED',
      rejectionReason: 'NIC image was unreadable',
    }
    resubmit.mockResolvedValue({ ...dealer, verificationStatus: 'PENDING' })

    render(<DealerVerificationGate profile={asyncData(dealer, reload)} />)

    await user.type(screen.getByLabelText('NIC number'), '991234567V')
    await user.click(screen.getByRole('button', { name: /resubmit for review/i }))

    await waitFor(() => expect(resubmit).toHaveBeenCalledWith('dealer-1', {
      companyName: 'Acme Motors',
      businessAddress: '1 Main St',
      city: 'Colombo',
      contactNumber: '+94701234567',
      verificationDocuments: { nic: '991234567V' },
    }))
    expect(reload).toHaveBeenCalled()
  })

  it('shows the business registration field and blocks submit without a document for a business dealer', async () => {
    const user = userEvent.setup()
    const dealer: DealerProfile = {
      ...BASE_DEALER,
      dealerType: 'business',
      verificationStatus: 'REJECTED',
      rejectionReason: 'Certificate was expired',
    }
    render(<DealerVerificationGate profile={asyncData(dealer)} />)

    expect(screen.getByLabelText('Business registration number')).toBeInTheDocument()
    expect(screen.queryByLabelText('NIC number')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /resubmit for review/i }))

    expect(
      await screen.findByText('Upload your business registration certificate to resubmit'),
    ).toBeInTheDocument()
    expect(resubmit).not.toHaveBeenCalled()
    expect(uploadDoc).not.toHaveBeenCalled()
  })
})
