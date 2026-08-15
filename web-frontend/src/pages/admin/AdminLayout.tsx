import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { BrandMark } from '../../components/layout/BrandMark'

const NAV = [
  { to: '/admin', end: true, label: 'Dashboard' },
  { to: '/admin/users', end: false, label: 'Users' },
  { to: '/admin/uploads', end: false, label: 'Uploads' },
  { to: '/admin/reports', end: false, label: 'Reports' },
  { to: '/admin/audit-logs', end: false, label: 'Audit logs' },
] as const

export function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const onSignOut = async () => {
    await logout()
    navigate('/admin/login', { replace: true })
  }

  return (
    <div className="admin-shell">
      <aside className="admin-shell__sidebar">
        <div className="admin-shell__brand">
          <BrandMark to="/admin" />
          <span className="admin-shell__badge">Admin</span>
        </div>

        <nav className="admin-shell__nav" aria-label="Admin">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `admin-shell__link${isActive ? ' admin-shell__link--active' : ''}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="admin-shell__footer">
          <p className="admin-shell__user">{user?.email}</p>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="admin-shell__main">
        <Outlet />
      </div>
    </div>
  )
}
