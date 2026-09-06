import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Bell, Check, Trash2, Package, Wallet, FileText, Target, ShoppingCart, Truck, MessageSquare, Users } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtDate } from '@/lib/business';
import { generateSystemNotifications } from '@/lib/notifications';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

const TYPE_ICONS = {
  stock: Package, financial: Wallet, quote: FileText, opportunity: Target,
  goal: Target, sale: ShoppingCart, purchase: Truck, attendance: MessageSquare,
};
const PRIORITY_STYLE = {
  high: 'border-l-rose-500 bg-rose-50/50',
  medium: 'border-l-amber-500 bg-amber-50/50',
  low: 'border-l-blue-500 bg-blue-50/50',
};

export default function Notificacoes() {
  const { company } = useOutletContext();
  const [notifications, setNotifications] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = async () => {
    if (!company) return;
    const list = await base44.entities.Notification.filter({ company_id: company.id }, '-created_date', 100);
    setNotifications(list);
  };
  useEffect(() => { load(); }, [company]);

  const handleGenerate = async () => {
    if (!company) return;
    const [products, financials, quotes, conversations] = await Promise.all([
      base44.entities.Product.filter({ company_id: company.id }, '-name', 500),
      base44.entities.FinancialEntry.filter({ company_id: company.id }, '-due_date', 500),
      base44.entities.Quote.filter({ company_id: company.id }, '-created_date', 200),
      base44.entities.Conversation.filter({ company_id: company.id }, '-created_date', 200),
    ]);
    await generateSystemNotifications(company.id, { products, financials, quotes, conversations });
    load();
  };

  const markRead = async (n) => {
    await base44.entities.Notification.update(n.id, { read: true });
    load();
  };

  const markAllRead = async () => {
    const unread = (notifications || []).filter((n) => !n.read);
    if (unread.length === 0) return;
    await base44.entities.Notification.bulkUpdate(unread.map((n) => ({ id: n.id, read: true })));
    load();
  };

  const handleDelete = async (n) => {
    await base44.entities.Notification.delete(n.id);
    load();
  };

  const filtered = (notifications || []).filter((n) => filter === 'all' || (filter === 'unread' && !n.read));

  return (
    <div className="mx-auto max-w-4xl px-5 py-8">
      <PageHeader
        title="Notificações"
        subtitle="Central de alertas do sistema."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleGenerate}>Verificar alertas</Button>
            <Button variant="outline" onClick={markAllRead}><Check className="mr-1.5 h-4 w-4" /> Marcar todas como lidas</Button>
          </div>
        }
      />

      <div className="mb-4 flex gap-2">
        <button onClick={() => setFilter('all')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>Todas</button>
        <button onClick={() => setFilter('unread')} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${filter === 'unread' ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>Não lidas</button>
      </div>

      <div className="space-y-2">
        {!notifications ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <Bell className="mx-auto mb-2 h-10 w-10 text-slate-200" />
            <p className="text-sm font-medium text-slate-700">Sem notificações</p>
            <p className="mt-1 text-xs text-slate-400">Clique em "Verificar alertas" para gerar notificações automáticas.</p>
          </div>
        ) : filtered.map((n) => {
          const Icon = TYPE_ICONS[n.type] || Bell;
          return (
            <div key={n.id} className={`flex items-start gap-3 rounded-xl border border-slate-200 border-l-4 bg-white p-4 shadow-sm ${PRIORITY_STYLE[n.priority]} ${n.read ? 'opacity-60' : ''}`}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                <Icon className="h-4.5 w-4.5 text-slate-500" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{n.title}</p>
                  {!n.read && <span className="h-2 w-2 rounded-full bg-indigo-500" />}
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{n.message}</p>
                <p className="mt-1 text-[10px] text-slate-400">{fmtDate(n.created_date)}</p>
              </div>
              <div className="flex gap-1">
                {!n.read && <button onClick={() => markRead(n)} className="rounded-md p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"><Check className="h-4 w-4" /></button>}
                <button onClick={() => handleDelete(n)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}