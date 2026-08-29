import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { DashboardIcon, GoalsIcon, PlanIcon, SettingsIcon, WorkoutsIcon } from './NavIcons';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: DashboardIcon, end: true },
  { to: '/plan', label: 'Plan', icon: PlanIcon, end: false },
  { to: '/workouts', label: 'Workouts', icon: WorkoutsIcon, end: false },
  { to: '/goals', label: 'Goals', icon: GoalsIcon, end: false },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, end: false },
];

export default function NavShell() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Training Dashboard</div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
            >
              {({ isActive }) => (
                <>
                  <span className={`nav-icon-badge${isActive ? ' active' : ''}`}>
                    <item.icon />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="muted">{user?.name}</span>
          <button className="secondary" onClick={logout}>
            Log out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Outlet />
      </main>

      <nav className="bottom-nav">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <span className={`nav-icon-badge${isActive ? ' active' : ''}`}>
                  <item.icon />
                </span>
                <span>{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
