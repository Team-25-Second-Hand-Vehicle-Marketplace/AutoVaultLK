import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { LoginPage } from '../../pages/LoginPage'
import { AuthContext, type AuthContextValue } from '../../auth/auth-context'

// Google's real button loads an external script and renders through its own
// SDK — neither works in jsdom, and isn't this test's concern. Standing in
// for it with a plain button that fires the same onCredential callback tests
// exactly what LoginPage is responsible for: what happens with the token
// once Google hands one back.
vi.mock('../../components/auth/GoogleSignInButton', () => ({
  GoogleSignInButton: ({ onCredential }: { onCredential: (idToken: string) => void }) => (
    <button type="button" onClick={() => onCredential('fake-id-token')}>
      Continue with Google (stub)
    </button>
  ),
}))

function renderPage(auth: Partial<AuthContextValue>) {
  const value: AuthContextValue = {
    user: null,
    isAuthenticated: false,
    initializing: false,
    login: vi.fn(),
    loginAdmin: vi.fn(),
    loginWithGoogle: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    updateUser: vi.fn(),
    ...auth,
  }

  return render(
    <MemoryRouter initialEntries={['/login']}>
      <AuthContext.Provider value={value}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/search" element={<div>Search page</div>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

describe('LoginPage — Continue with Google', () => {
  it('signs in and redirects once Google hands back a credential', async () => {
    const loginWithGoogle = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderPage({ loginWithGoogle })

    await user.click(screen.getByRole('button', { name: 'Continue with Google (stub)' }))

    expect(loginWithGoogle).toHaveBeenCalledWith('fake-id-token')
    expect(await screen.findByText('Search page')).toBeInTheDocument()
  })

  it('shows an error instead of redirecting when the backend rejects the credential', async () => {
    const loginWithGoogle = vi.fn().mockRejectedValue(new Error('network down'))
    const user = userEvent.setup()
    renderPage({ loginWithGoogle })

    await user.click(screen.getByRole('button', { name: 'Continue with Google (stub)' }))

    expect(
      await screen.findByText('Could not sign you in with Google. Please try again.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Search page')).not.toBeInTheDocument()
  })
})
