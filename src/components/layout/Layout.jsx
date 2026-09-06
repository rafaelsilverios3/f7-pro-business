import React, { useState, useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import Sidebar from './Sidebar';
import { useCompany } from '../../lib/useCompany';
import { base44 } from '../../api/base44Client';

export default function Layout() {
  const { company, loading } = useCompany();
  const [unread, setUnread] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!company) return;
    let cancelled = false;
    base44.entities.Notification
      .filter({ company_id: company.id, read: false }, '-created_date', 50)
      .then((list) => { if (!cancelled) setUnread(list.length); })
      .catch(() => { if (!cancelled) setUnread(0); });
    return () => { cancelled = true; };
  }, [company]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-800" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar company={company} mobileOpen={mobileOpen} onOpenMobile={setMobileOpen} />
      <main className="flex-1 overflow-x-hidden pb-10 md:pb-0">
        <div className="sticky top-0 z-30 flex items-center justify-end border-b border-slate-200 bg-white/80 px-5 py-2.5 backdrop-blur md:px-8">
          <Link to="/notificacoes" className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700">
            <Bell className="h-5 w-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </Link>
        </div>
        <Outlet context={{ company }} />
      </main>
    </div>
  );
}