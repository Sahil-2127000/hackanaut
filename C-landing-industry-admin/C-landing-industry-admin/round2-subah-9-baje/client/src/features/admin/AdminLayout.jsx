import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Logo } from '../../components/ui/Logo'
import { cn } from '../../lib/cn'
import { useAuth } from '../auth/AuthContext'
import { ADMIN_TABS } from './adminApi'

/**
 * Ops console shell: dark header with tabs. On phones the tabs become a
 * scrollable strip under the logo row, so every screen is one tap away.
 */
export default function AdminLayout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function signOut() {
    navigate('/', { replace: true })
    await logout()
  }

  return (
    <div className="min-h-svh bg-paper">
      <header className="sticky top-0 z-[500] bg-forest-deep text-paper">
        <div className="mx-auto flex max-w-[1520px] flex-wrap items-center justify-between gap-x-7 px-[clamp(16px,3vw,40px)]">
          <NavLink to="/admin" className="flex min-h-14 items-center gap-2 md:min-h-16">
            <Logo />
            <span className="label text-sage">Admin</span>
          </NavLink>
          <nav aria-label="Admin" className="order-last -mx-[clamp(16px,3vw,40px)] flex w-[calc(100%+2*clamp(16px,3vw,40px))] gap-6 overflow-x-auto border-t border-paper/10 px-[clamp(16px,3vw,40px)] md:order-none md:mx-0 md:w-auto md:self-stretch md:border-0 md:px-0">
            {ADMIN_TABS.map((t) => (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={({ isActive }) =>
                  cn('label flex min-h-11 shrink-0 items-center border-b-2 whitespace-nowrap transition-colors', isActive ? 'border-straw text-paper' : 'border-transparent text-sage-light hover:text-paper')
                }
              >
                {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-right text-[13px] leading-tight">
              <span className="block font-semibold max-sm:hidden">{user.name ?? 'Admin'}</span>
              <button type="button" onClick={signOut} className="label min-h-8 text-xs text-sage hover:text-straw-light">
                Sign out
              </button>
            </span>
            <span aria-hidden="true" className="label grid size-[38px] place-items-center bg-straw text-xs text-forest-deep max-sm:hidden">
              {(user.name ?? 'A')
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
