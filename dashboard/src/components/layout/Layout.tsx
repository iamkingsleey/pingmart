/**
 * @file components/layout/Layout.tsx
 * @description Root layout: sidebar (desktop) + bottom nav (mobile) + main content.
 */
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';

export default function Layout() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      {/* Main content — offset by sidebar width on desktop */}
      <main className="lg:ml-60 pb-20 lg:pb-0 min-h-screen">
        <Outlet />
      </main>
      <BottomNav />
    </div>
  );
}
