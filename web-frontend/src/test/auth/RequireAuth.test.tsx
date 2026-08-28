import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireAuth } from '../../auth/RequireAuth'
import { useAuth } from '../../auth/useAuth'

vi.mock('../../auth/useAuth', () => ({
  useAuth: vi.fn(),
}))

const mockedUseAuth = vi.mocked(useAuth)

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/protected"
          element={
            <RequireAuth>
              <div>Protected content</div>
            </RequireAuth>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  it('shows a loading state while the session is still initializing', () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      initializing: true,
    } as never)

    renderAt('/protected')

    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('redirects to /login when not authenticated', () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: false,
      initializing: false,
    } as never)

    renderAt('/protected')

    expect(screen.getByText('Login page')).toBeInTheDocument()
    expect(screen.queryByText('Protected content')).not.toBeInTheDocument()
  })

  it('renders children when authenticated', () => {
    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      initializing: false,
    } as never)

    renderAt('/protected')

    expect(screen.getByText('Protected content')).toBeInTheDocument()
  })
})
