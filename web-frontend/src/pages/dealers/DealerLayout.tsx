import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { BrandMark } from '../../components/layout/BrandMark'
import { Button } from '../../components/ui/Button'

const NAV = [{ to: '/dealer', end: true, label: 'Dashboard' }] as const

export function DealerLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onSignOut = async () => {
    await logout()
    navigate('/dealer/login', { replace: true })
  }

  return (
    <div className="dealer-shell">
      <aside className="dealer-shell__sidebar">
        <div className="dealer-shell__brand">
          <BrandMark to="/dealer" />
          <span className="dealer-shell__badge">Dealer</span>
        </div>

        <nav className="dealer-shell__nav" aria-label="Dealer">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `dealer-shell__link${isActive ? ' dealer-shell__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="dealer-shell__footer">
          <p className="dealer-shell__user">{user?.email}</p>
          <Button type="button" variant="ghost" size="sm" onClick={() => void onSignOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      <div className="dealer-shell__main">
        <Outlet />
      </div>
    </div>
  )
}
