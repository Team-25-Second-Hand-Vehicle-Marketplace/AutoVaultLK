import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { Heart, LogOut, Menu, Plus, Search, X } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { BrandMark } from './BrandMark'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/search', label: 'Browse', end: false },
  { to: '/search?sort=newest', label: 'Just listed', end: false },
  { to: '/dealer/login', label: 'Dealers', end: false },
]

export function Header() {
  const { user, isAuthenticated, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  // Each panel remembers the page it was opened on, so navigating anywhere
  // closes it without an effect.
  const [mobilePath, setMobilePath] = useState<string | null>(null)
  const [searchPath, setSearchPath] = useState<string | null>(null)
  const mobileOpen = mobilePath === pathname
  const searchOpen = searchPath === pathname
  const [keyword, setKeyword] = useState('')
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // On the landing page the header floats over the hero and only turns solid
  // once you scroll; everywhere else it is always solid.
  const overlay = pathname === '/' && !scrolled

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus()
  }, [searchOpen])

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
    setSearchPath(null)
  }

  return (
    <header
      className={`nx-header${overlay ? ' nx-header--overlay' : ''}${mobileOpen ? ' nx-header--open' : ''}`}
    >
      <div className="nx-header__inner">
        <BrandMark to="/" />

        <nav className="nx-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                // "Just listed" shares /search with Browse; only Browse should light up.
                isActive && item.label !== 'Just listed' ? 'nx-nav__link is-active' : 'nx-nav__link'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="nx-header__actions">
          <form
            className={`nx-search${searchOpen ? ' is-open' : ''}`}
            onSubmit={submitSearch}
            role="search"
          >
            <input
              ref={searchRef}
              type="search"
              placeholder="Try “Toyata Corrola under 8.5m deisel”…"
              aria-label="Search vehicles"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              tabIndex={searchOpen ? 0 : -1}
            />
            <button
              type={searchOpen && keyword.trim() ? 'submit' : 'button'}
              className="nx-icon-btn"
              aria-label={searchOpen ? 'Search' : 'Open search'}
              onClick={() => {
                if (!searchOpen) setSearchPath(pathname)
                else if (!keyword.trim()) setSearchPath(null)
              }}
            >
              <Search size={18} />
            </button>
          </form>

          <Link
            to={isAuthenticated ? '/saved' : '/login'}
            className="nx-icon-btn"
            aria-label="Saved vehicles"
          >
            <Heart size={18} />
          </Link>

          {isAuthenticated ? (
            <div className="nx-user" ref={menuRef}>
              <button
                type="button"
                className="nx-user__trigger"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="nx-user__avatar" aria-hidden="true">
                  {user?.name?.charAt(0).toUpperCase() ?? '?'}
                </span>
              </button>

              {menuOpen && (
                <div className="nx-user__menu" role="menu">
                  <div className="nx-user__who">
                    <strong>{user?.name}</strong>
                    <span>{user?.email}</span>
                  </div>
                  <Link
                    to="/saved"
                    role="menuitem"
                    className="nx-user__item"
                    onClick={() => setMenuOpen(false)}
                  >
                    <Heart size={15} /> Saved vehicles
                  </Link>
                  <button
                    type="button"
                    role="menuitem"
                    className="nx-user__item"
                    onClick={handleLogout}
                  >
                    <LogOut size={15} /> Sign out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link to="/login" className="nx-link-btn">
              Sign in
            </Link>
          )}

          <Link to="/dealer/login" className="nx-btn nx-btn--outline nx-header__cta">
            <Plus size={16} /> Add listing
          </Link>

          <button
            type="button"
            className="nx-icon-btn nx-header__burger"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
            onClick={() => setMobilePath(mobileOpen ? null : pathname)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <nav className="nx-mobile" aria-label="Mobile">
          {NAV.map((item) => (
            <Link key={item.label} to={item.to}>
              {item.label}
            </Link>
          ))}
          <Link to="/dealer/login">Add listing</Link>
          {!isAuthenticated && <Link to="/login">Sign in</Link>}
        </nav>
      )}
    </header>
  )
}
