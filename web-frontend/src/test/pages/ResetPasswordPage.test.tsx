import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ResetPasswordPage } from '../../pages/ResetPasswordPage'

const confirmPasswordReset = vi.fn()
vi.mock('../../api/auth.api', () => ({
  confirmPasswordReset: (token: string, newPassword: string) =>
    confirmPasswordReset(token, newPassword),
}))

function renderPage(initialEntry = '/reset-password?token=abc123') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/login" element={<div>Login page</div>} />
        <Route path="/forgot-password" element={<div>Forgot password page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  it('submits the new password with the token from the URL', async () => {
    confirmPasswordReset.mockResolvedValue({ message: 'ok' })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'NewStrong1')
    await user.type(screen.getByLabelText('Confirm new password'), 'NewStrong1')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(confirmPasswordReset).toHaveBeenCalledWith('abc123', 'NewStrong1')
    expect(await screen.findByText(/Your password has been reset/)).toBeInTheDocument()
  })

  it('rejects mismatched passwords before submitting', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'NewStrong1')
    await user.type(screen.getByLabelText('Confirm new password'), 'Different1')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText('Passwords do not match')).toBeInTheDocument()
    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })

  it('shows a retry link when the token is invalid or expired', async () => {
    confirmPasswordReset.mockRejectedValue(new Error('gone'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('New password'), 'NewStrong1')
    await user.type(screen.getByLabelText('Confirm new password'), 'NewStrong1')
    await user.click(screen.getByRole('button', { name: 'Reset password' }))

    expect(await screen.findByText(/This reset link is invalid or has expired/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Request a new link' })).toBeInTheDocument()
  })

  it('sends straight to a "missing token" state when the URL has none', () => {
    renderPage('/reset-password')

    expect(screen.getByText('Reset link is missing its token')).toBeInTheDocument()
    expect(confirmPasswordReset).not.toHaveBeenCalled()
  })
})
