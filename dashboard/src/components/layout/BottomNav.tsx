/**
 * @file components/layout/BottomNav.tsx
 * @description Mobile bottom tab bar — visible on small screens only.
 */
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, ShoppingBag, Package, BarChart2, Settings } from 'lucide-react';

const TABS = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Home' },
  { to: '/orders',    icon: ShoppingBag,     label: 'Orders' },
  { to: '/catalog',   icon: Package,         label: 'Catalog' },
  { to: '/analytics', icon: BarChart2,       label: 'Analytics' },
  { to: '/settings',  icon: Settings,        label: 'Settings' },
];

export default function BottomNav() {
  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-20 bg-white border-t border-gray-100 shadow-lg">
      <div className="flex">
        {TABS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? 'text-brand' : 'text-gray-400'
              }`
            }
          >
            <Icon size={20} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
