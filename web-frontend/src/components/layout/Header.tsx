import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { BrandMark } from './BrandMark'

export function Header() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // A dropdown that only closes via its own trigger feels stuck — close on an
  // outside click and on Escape, the two things users actually try.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const handleLogout = async () => {
    setMenuOpen(false)
    await logout()
    navigate('/')
  }

  const submitSearch = (e: FormEvent) => {
    e.preventDefault()
    const q = keyword.trim()
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search')
    setKeyword('')
  }

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <BrandMark to="/" />

        <form className="header-search" onSubmit={submitSearch} role="search">
          <svg
            className="header-search__icon"
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Try “Toyata Corrola under 8.5m deisel”…"
            aria-label="Search vehicles"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </form>

        <nav className="site-header__nav" aria-label="Main">
          <NavLink
            to="/search"
            className={({ isActive }) =>
              isActive ? 'site-header__link site-header__link--active' : 'site-header__link'
            }
          >
            Browse
          </NavLink>
          <NavLink
            to="/dealer/login"
            className={({ isActive }) =>
              isActive ? 'site-header__link site-header__link--active' : 'site-header__link'
            }
          >
            Dealers
          </NavLink>
        </nav>

        <div className="site-header__actions">
          {/* Saved is a guarded route, so while signed out this links to
              login rather than dead-ending on a redirect. */}
          <Link to={isAuthenticated ? '/saved' : '/login'} className="site-header__saved">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 21s-6.7-4.35-9.3-8.1C.8 10.1 1.4 6.6 4.3 5.1c2.2-1.1 4.6-.4 6 1.4l1.7 2.1 1.7-2.1c1.4-1.8 3.8-2.5 6-1.4 2.9 1.5 3.5 5 1.6 7.8C18.7 16.65 12 21 12 21z" />
            </svg>
            <span>Saved</span>
          </Link>

          {isAuthenticated ? (
            <div className="user-menu" ref={menuRef}>
              <button
                type="button"
                className="user-menu__trigger"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="user-menu__avatar" aria-hidden="true">
                  {user?.name?.charAt(0).toUpperCase() ?? '?'}
                </span>
                <span className="user-menu__name">{user?.name}</span>
              </button>

              {menuOpen && (
                <div className="user-menu__dropdown" role="menu">
                  <div className="user-menu__email">{user?.email}</div>
                  <Link
                    to="/saved"
                    role="menuitem"
                    className="user-menu__item"
                    onClick={() => setMenuOpen(false)}
                  >
                    Saved vehicles
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="user-menu__item"
                    onClick={handleLogout}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="button button--primary site-header__signin">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5" />
              </svg>
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
