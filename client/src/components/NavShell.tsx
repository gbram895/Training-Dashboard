import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/plan', label: 'Plan', icon: 'plan', end: false },
  { to: '/workouts', label: 'Workouts', icon: 'workouts', end: false },
  { to: '/goals', label: 'Goals', icon: 'goals', end: false },
  { to: '/settings', label: 'Settings', icon: 'settings', end: false },
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
                    <img src={`/nav-icons/${item.icon}.png`} alt="" />
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
                  <img src={`/nav-icons/${item.icon}.png`} alt="" />
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
