import React, { useState, useEffect } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Trash2, Zap, Play, History, Settings2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtDate } from '@/lib/business';
import { TRIGGER_LABELS, ACTION_LABELS } from '@/lib/automations';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export default function Automacoes() {
  const { company } = useOutletContext();
  const [automations, setAutomations] = useState(null);
  const [logs, setLogs] = useState([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const load = async () => {
    if (!company) return;
    const [a, l] = await Promise.all([
      base44.entities.Automation.filter({ company_id: company.id }, '-created_date', 200),
      base44.entities.AutomationLog.filter({ company_id: company.id }, '-created_date', 50),
    ]);
    setAutomations(a);
    setLogs(l);
  };
  useEffect(() => { load(); }, [company]);

  const toggleActive = async (auto) => {
    await base44.entities.Automation.update(auto.id, { active: !auto.active });
    load();
  };

  const handleDelete = async (auto) => {
    if (!confirm('Excluir esta automação?')) return;
    await base44.entities.Automation.delete(auto.id);
    load();
  };

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Automações"
        subtitle="Crie automações com gatilho, condição e ação. Evento → Condição → Ação."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowLogs(!showLogs)}><History className="mr-1.5 h-4 w-4" /> Logs</Button>
            <Button onClick={() => setDialogOpen(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova automação</Button>
          </div>
        }
      />

      {showLogs && (
        <div className="mb-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">Histórico de execuções</h3>
          </div>
          {logs.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-400">Nenhuma execução registrada.</p>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                    <th className="px-4 py-2 font-medium">Automação</th>
                    <th className="px-4 py-2 font-medium">Gatilho</th>
                    <th className="px-4 py-2 font-medium">Status</th>
                    <th className="px-4 py-2 font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b border-slate-50">
                      <td className="px-4 py-2 text-slate-700">{l.automation_name}</td>
                      <td className="px-4 py-2 text-slate-500">{TRIGGER_LABELS[l.trigger] || l.trigger}</td>
                      <td className="px-4 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          l.status === 'success' ? 'bg-emerald-100 text-emerald-700' :
                          l.status === 'error' ? 'bg-rose-100 text-rose-700' :
                          'bg-slate-100 text-slate-500'
                        }`}>{l.status === 'success' ? 'Sucesso' : l.status === 'error' ? 'Erro' : 'Ignorado'}</span>
                      </td>
                      <td className="px-4 py-2 text-slate-400">{fmtDate(l.created_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {!automations ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">Carregando...</div>
        ) : automations.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-12 text-center">
            <Zap className="mx-auto mb-3 h-10 w-10 text-slate-200" />
            <p className="text-sm font-medium text-slate-700">Nenhuma automação criada</p>
            <p className="mt-1 text-xs text-slate-400">Crie automações para reagir automaticamente a eventos do sistema.</p>
          </div>
        ) : automations.map((a) => (
          <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${a.active ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{a.name}</p>
                  <p className="text-[10px] text-slate-400">{TRIGGER_LABELS[a.trigger]}</p>
                </div>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input type="checkbox" checked={a.active} onChange={() => toggleActive(a)} className="peer sr-only" />
                <div className="h-5 w-9 rounded-full bg-slate-200 peer-checked:bg-emerald-500 peer-checked:after:translate-x-full after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all" />
              </label>
            </div>
            <div className="space-y-1.5">
              {(a.conditions || []).length > 0 && (
                <div className="rounded-lg bg-slate-50 p-2">
                  <p className="text-[10px] font-medium text-slate-400">CONDIÇÕES</p>
                  {(a.conditions || []).map((c, i) => (
                    <p key={i} className="text-xs text-slate-600">{c.field} {c.operator} {c.value}</p>
                  ))}
                </div>
              )}
              <div className="rounded-lg bg-indigo-50 p-2">
                <p className="text-[10px] font-medium text-indigo-400">AÇÕES</p>
                {(a.actions || []).map((act, i) => (
                  <p key={i} className="text-xs text-indigo-700">{ACTION_LABELS[act.type] || act.type}{act.params?.title ? `: ${act.params.title}` : ''}</p>
                ))}
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">{a.last_run ? `Última: ${fmtDate(a.last_run)}` : 'Nunca executada'}</span>
              <button onClick={() => handleDelete(a)} className="rounded-md p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
      </div>

      <AutomationDialog open={dialogOpen} onClose={() => setDialogOpen(false)} company={company} onDone={load} />
    </div>
  );
}

function AutomationDialog({ open, onClose, company, onDone }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState('new_sale');
  const [actions, setActions] = useState([{ type: 'create_task', params: { title: '', description: '' } }]);
  const [taskTitle, setTaskTitle] = useState('');
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const finalActions = actions.map((a) => {
      if (a.type === 'create_task' || a.type === 'follow_up') return { type: a.type, params: { title: taskTitle, description: '' } };
      if (a.type === 'notify') return { type: 'notify', params: { title: notifyTitle, message: notifyMessage } };
      return a;
    });
    await base44.entities.Automation.create({
      company_id: company.id, name, trigger, conditions: [], actions: finalActions, active: true,
    });
    setName(''); setTaskTitle(''); setNotifyTitle(''); setNotifyMessage('');
    onDone?.();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Nova automação</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome da automação *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Follow-up de nova venda" required />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Gatilho (evento)</Label>
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
              {Object.entries(TRIGGER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Ação</Label>
            <select
              value={actions[0]?.type || 'create_task'}
              onChange={(e) => setActions([{ type: e.target.value, params: {} }])}
              className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              {Object.entries(ACTION_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          {actions[0]?.type === 'create_task' || actions[0]?.type === 'follow_up' ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Título da tarefa</Label>
              <Input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ex: Entrar em contato com o cliente" />
            </div>
          ) : actions[0]?.type === 'notify' ? (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs">Título da notificação</Label>
                <Input value={notifyTitle} onChange={(e) => setNotifyTitle(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Mensagem</Label>
                <Textarea value={notifyMessage} onChange={(e) => setNotifyMessage(e.target.value)} rows={2} className="resize-none" />
              </div>
            </>
          ) : null}
          <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
            <p className="font-medium text-slate-600">Como funciona:</p>
            <p className="mt-1">Quando o evento <strong>{TRIGGER_LABELS[trigger]}</strong> ocorrer, a ação será executada automaticamente. Cada execução é registrada no log.</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Criar automação</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}