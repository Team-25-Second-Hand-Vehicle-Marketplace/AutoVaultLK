import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ForgotPasswordPage } from '../../pages/ForgotPasswordPage'

const requestPasswordReset = vi.fn()
vi.mock('../../api/auth.api', () => ({
  requestPasswordReset: (email: string) => requestPasswordReset(email),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  it('submits the email and shows a non-committal success message', async () => {
    requestPasswordReset.mockResolvedValue({ message: 'ok' })
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'buyer@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(requestPasswordReset).toHaveBeenCalledWith('buyer@example.com')
    expect(await screen.findByText('Check your email')).toBeInTheDocument()
    expect(screen.getByText('buyer@example.com', { exact: false })).toBeInTheDocument()
  })

  it('shows an error instead of the success state when the request fails', async () => {
    requestPasswordReset.mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Email'), 'buyer@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))

    expect(
      await screen.findByText('Could not send the email. Please try again in a few minutes.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument()
  })
})
