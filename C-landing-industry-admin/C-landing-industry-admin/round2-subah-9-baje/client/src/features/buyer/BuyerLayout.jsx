import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { useAuth } from '../auth/AuthContext'

const TABS = [
  { to: '/buyer', label: 'Supply map', end: true },
  { to: '/buyer/calendar', label: 'Calendar' },
  { to: '/buyer/orders', label: 'Orders' },
]

/**
 * Desktop-first buyer dashboard shell. Sends buyers without a plant location to
 * the setup screen first (distances and prices depend on it).
 */
export default function BuyerLayout() {
  const { user, logout } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const company = user.buyer?.company

  if (!user.buyer?.plant && pathname !== '/buyer/setup') return <Navigate to="/buyer/setup" replace />

  async function signOut() {
    navigate('/', { replace: true })
    await logout()
  }

  return (
    <div className="min-h-svh bg-paper">
      <header className="bg-forest-deep text-paper">
        <div className="mx-auto flex min-h-16 max-w-[1520px] flex-wrap items-center justify-between gap-x-7 gap-y-2 px-[clamp(16px,3vw,40px)]">
          <NavLink to="/buyer" className="flex items-center gap-2">
            <Logo />
            <span className="label text-sage">Buyer</span>
          </NavLink>
          {user.buyer?.plant && (
            <nav aria-label="Buyer" className="flex gap-7 self-stretch">
              {TABS.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  end={t.end}
                  className={({ isActive }) =>
                    cn('label flex items-center border-b-2 transition-colors', isActive ? 'border-straw text-paper' : 'border-transparent text-sage-light hover:text-paper')
                  }
                >
                  {t.label}
                </NavLink>
              ))}
            </nav>
          )}
          <div className="flex items-center gap-3">
            <span className="text-right text-[13px] leading-tight">
              <span className="block font-semibold">{company ?? user.name}</span>
              <button type="button" onClick={signOut} className="label text-xs text-sage hover:text-straw-light">
                Sign out
              </button>
            </span>
            <span aria-hidden="true" className="label grid size-[38px] place-items-center bg-straw text-xs text-forest-deep">
              {(company ?? user.name ?? '?')
                .split(' ')
                .map((w) => w[0])
                .slice(0, 2)
                .join('')}
            </span>
          </div>
        </div>
      </header>
      <main id="main">
        <Outlet />
      </main>
    </div>
  )
}
