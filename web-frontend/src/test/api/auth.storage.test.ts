import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jwtDecode } from 'jwt-decode'
import {
  clearSession,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  isAccessTokenExpired,
  saveSession,
} from '../../api/auth.storage'
import type { AuthUser } from '../../api/auth.types'

vi.mock('jwt-decode', () => ({
  jwtDecode: vi.fn(),
}))

const user: AuthUser = {
  id: '1',
  email: 'buyer@example.com',
  role: 'BUYER',
} as AuthUser

beforeEach(() => {
  localStorage.clear()
  vi.mocked(jwtDecode).mockReset()
})

describe('saveSession / clearSession', () => {
  it('persists the access token, refresh token, and user', () => {
    saveSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user })

    expect(getAccessToken()).toBe('access-1')
    expect(getRefreshToken()).toBe('refresh-1')
    expect(getStoredUser()).toEqual(user)
  })

  it('removes all session data', () => {
    saveSession({ accessToken: 'access-1', refreshToken: 'refresh-1', user })

    clearSession()

    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
    expect(getStoredUser()).toBeNull()
  })
})

describe('getStoredUser', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredUser()).toBeNull()
  })

  it('clears the session and returns null when the stored user is corrupt JSON', () => {
    localStorage.setItem('autovault.accessToken', 'access-1')
    localStorage.setItem('autovault.user', '{not valid json')

    expect(getStoredUser()).toBeNull()
    expect(getAccessToken()).toBeNull()
  })
})

describe('isAccessTokenExpired', () => {
  it('returns true when there is no token', () => {
    expect(isAccessTokenExpired()).toBe(true)
  })

  it('returns true when the token cannot be decoded', () => {
    localStorage.setItem('autovault.accessToken', 'garbage')
    vi.mocked(jwtDecode).mockImplementation(() => {
      throw new Error('invalid token')
    })

    expect(isAccessTokenExpired()).toBe(true)
  })

  it('returns false for a token that expires well in the future', () => {
    localStorage.setItem('autovault.accessToken', 'valid-token')
    const futureExp = Math.floor(Date.now() / 1000) + 3600
    vi.mocked(jwtDecode).mockReturnValue({ exp: futureExp } as never)

    expect(isAccessTokenExpired()).toBe(false)
  })

  it('returns true for a token within the skew window of expiring', () => {
    localStorage.setItem('autovault.accessToken', 'valid-token')
    const nearExp = Math.floor(Date.now() / 1000) + 10
    vi.mocked(jwtDecode).mockReturnValue({ exp: nearExp } as never)

    expect(isAccessTokenExpired(30)).toBe(true)
  })

  it('returns true for an already-expired token', () => {
    localStorage.setItem('autovault.accessToken', 'valid-token')
    const pastExp = Math.floor(Date.now() / 1000) - 60
    vi.mocked(jwtDecode).mockReturnValue({ exp: pastExp } as never)

    expect(isAccessTokenExpired()).toBe(true)
  })
})
