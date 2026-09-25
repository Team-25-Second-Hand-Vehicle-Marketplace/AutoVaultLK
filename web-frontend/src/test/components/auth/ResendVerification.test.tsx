import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResendVerification } from '../../../components/auth/ResendVerification'
import { isEmailNotVerifiedMessage } from '../../../components/auth/email-verification'
import { resendVerification } from '../../../api/auth.api'

vi.mock('../../../api/auth.api', () => ({ resendVerification: vi.fn() }))

const resend = vi.mocked(resendVerification)

describe('isEmailNotVerifiedMessage', () => {
  it('matches the message auth-user-service returns for an unverified account', () => {
    expect(isEmailNotVerifiedMessage('Please verify your email address before signing in.')).toBe(
      true,
    )
  })

  it('ignores other login errors and empty values', () => {
    expect(isEmailNotVerifiedMessage('Invalid email or password')).toBe(false)
    expect(isEmailNotVerifiedMessage(null)).toBe(false)
    expect(isEmailNotVerifiedMessage(undefined)).toBe(false)
  })
})

describe('ResendVerification', () => {
  beforeEach(() => {
    resend.mockReset()
    resend.mockResolvedValue({ message: 'ok' })
  })

  it('sends to the known address without asking for one', async () => {
    render(<ResendVerification email="buyer@example.com" />)

    expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

    await waitFor(() => expect(resend).toHaveBeenCalledWith('buyer@example.com'))
    expect(await screen.findByRole('status')).toHaveTextContent('buyer@example.com')
    expect(screen.getByRole('button', { name: 'Send again' })).toBeEnabled()
  })

  it('asks for an email when none is known and sends what was typed', async () => {
    render(<ResendVerification />)

    await userEvent.type(screen.getByLabelText('Email address'), '  typed@example.com ')
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

    await waitFor(() => expect(resend).toHaveBeenCalledWith('typed@example.com'))
  })

  it('does not call the API for an invalid address', async () => {
    render(<ResendVerification />)

    await userEvent.type(screen.getByLabelText('Email address'), 'not-an-email')
    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the email address')
    expect(resend).not.toHaveBeenCalled()
  })

  it('shows an error and stays usable when the request fails', async () => {
    resend.mockRejectedValue(new Error('network down'))
    render(<ResendVerification email="buyer@example.com" />)

    await userEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))

    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeEnabled()
  })
})
