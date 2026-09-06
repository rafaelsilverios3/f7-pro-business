import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { BrainCircuit, TrendingUp, TrendingDown, AlertTriangle, Target, DollarSign, Users, Package, Wallet, ArrowRight, CheckCircle2, XCircle, Lightbulb } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { fmtMoney, fmtNum, fmtMoneyShort } from '@/lib/business';
import { generateInsights, INSIGHT_TYPE_LABELS, INSIGHT_PRIORITY_COLORS } from '@/lib/intelligence';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const TYPE_ICONS = {
  growth: TrendingUp, decline: TrendingDown, margin: DollarSign, stock: Package,
  customer: Users, financial: Wallet, concentration: AlertTriangle, goal: Target, projection: TrendingUp,
};

const STAGE_LABELS = { new: 'Novo', qualified: 'Qualificado', proposal: 'Proposta', negotiation: 'Negociação', won: 'Ganho', lost: 'Perdido' };
const STAGE_COLORS = {
  new: 'bg-blue-100 text-blue-700', qualified: 'bg-cyan-100 text-cyan-700',
  proposal: 'bg-amber-100 text-amber-700', negotiation: 'bg-violet-100 text-violet-700',
  won: 'bg-emerald-100 text-emerald-700', lost: 'bg-rose-100 text-rose-700',
};
const SOURCE_LABELS = { crm: 'CRM', atendimento: 'Atendimento', intelligence: 'Intelligence' };

export default function Intelligence() {
  const { company } = useOutletContext();
  const [insights, setInsights] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [period, setPeriod] = useState('month');
  const [converting, setConverting] = useState(null);

  const load = async () => {
    if (!company) return;
    const [ins, opps] = await Promise.all([
      generateInsights(company.id, period),
      base44.entities.Opportunity.filter({ company_id: company.id }, '-created_date', 200),
    ]);
    setInsights(ins);
    setOpportunities(opps);
  };
  useEffect(() => { load(); }, [company, period]);

  const handleConvertInsight = (insight) => {
    setConverting(insight);
  };

  const submitConvert = async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await base44.entities.Opportunity.create({
      company_id: company.id,
      title: form.get('title'),
      description: converting.description || form.get('description'),
      source: 'intelligence',
      customer_name: form.get('customer_name') || '',
      value: Number(form.get('value')) || 0,
      assignee: form.get('assignee') || '',
      stage: 'new',
      insight_id: converting.id || '',
    });
    setConverting(null);
    load();
  };

  const updateStage = async (opp, stage) => {
    await base44.entities.Opportunity.update(opp.id, { stage });
    load();
  };

  const handleDelete = async (opp) => {
    if (!confirm('Excluir esta oportunidade?')) return;
    await base44.entities.Opportunity.delete(opp.id);
    load();
  };

  const oppStats = useMemo(() => {
    const open = opportunities.filter((o) => !['won', 'lost'].includes(o.stage));
    const won = opportunities.filter((o) => o.stage === 'won');
    return {
      total: opportunities.length,
      open: open.length,
      pipeline: open.reduce((s, o) => s + (o.value || 0), 0),
      won: won.reduce((s, o) => s + (o.value || 0), 0),
    };
  }, [opportunities]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="F7 Intelligence"
        subtitle="Insights automáticos e oportunidades gerados a partir dos dados reais do sistema."
        action={
          <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
            {[{ v: 'day', l: 'Hoje' }, { v: 'month', l: 'Mês' }, { v: 'year', l: 'Ano' }].map((p) => (
              <button key={p.v} onClick={() => setPeriod(p.v)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${period === p.v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{p.l}</button>
            ))}
          </div>
        }
      />

      <div className="mb-5 flex items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-xs text-violet-700">
        <Lightbulb className="h-4 w-4 shrink-0" />
        <span>Todos os insights são calculados deterministicamente sobre os dados reais do sistema. Nenhum número é inventado.</span>
      </div>

      {/* Opportunities summary */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Oportunidades abertas</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{oppStats.open}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Pipeline</p>
          <p className="mt-1 text-xl font-semibold text-indigo-600">{fmtMoney(oppStats.pipeline)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Ganho</p>
          <p className="mt-1 text-xl font-semibold text-emerald-600">{fmtMoney(oppStats.won)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Insights ativos</p>
          <p className="mt-1 text-xl font-semibold text-violet-600">{insights?.length || 0}</p>
        </div>
      </div>

      {/* Insights */}
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <BrainCircuit className="h-4 w-4 text-violet-500" /> Insights automáticos
      </h3>
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {!insights ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">Analisando dados...</div>
        ) : insights.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto mb-2 h-10 w-10 text-emerald-300" />
            <p className="text-sm font-medium text-slate-700">Nenhum alerta crítico detectado</p>
            <p className="mt-1 text-xs text-slate-400">O sistema está saudável no período selecionado.</p>
          </div>
        ) : insights.map((ins, i) => {
          const Icon = TYPE_ICONS[ins.type] || AlertTriangle;
          return (
            <div key={i} className={`rounded-2xl border bg-white p-5 shadow-sm ${INSIGHT_PRIORITY_COLORS[ins.priority]}`}>
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/60">
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{ins.title}</p>
                    <p className="text-[10px] text-slate-500">{INSIGHT_TYPE_LABELS[ins.type]} · {ins.period_label}</p>
                  </div>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${INSIGHT_PRIORITY_COLORS[ins.priority]}`}>
                  {ins.priority === 'high' ? 'Alta' : ins.priority === 'medium' ? 'Média' : 'Baixa'}
                </span>
              </div>
              <p className="mb-3 text-sm text-slate-600">{ins.description}</p>
              <div className="mb-3 grid grid-cols-3 gap-2 rounded-lg bg-slate-50 p-2.5 text-center">
                <div>
                  <p className="text-[10px] text-slate-400">Atual</p>
                  <p className="text-sm font-semibold text-slate-700">{typeof ins.current_value === 'number' && ins.current_value > 100 ? fmtMoneyShort(ins.current_value) : fmtNum(ins.current_value)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Anterior</p>
                  <p className="text-sm font-semibold text-slate-500">{typeof ins.previous_value === 'number' && ins.previous_value > 100 ? fmtMoneyShort(ins.previous_value) : fmtNum(ins.previous_value)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Variação</p>
                  <p className={`text-sm font-semibold ${ins.variation_pct > 0 ? 'text-emerald-600' : ins.variation_pct < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                    {ins.variation_pct > 0 ? '+' : ''}{ins.variation_pct.toFixed(1)}%
                  </p>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="font-medium text-slate-500">Impacto:</span>
                  <span className="text-slate-600">{ins.impact}</span>
                </div>
                <div className="flex items-start gap-1.5 text-xs">
                  <span className="font-medium text-slate-500">Ação sugerida:</span>
                  <span className="text-slate-600">{ins.suggested_action}</span>
                </div>
              </div>
              <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => handleConvertInsight(ins)}>
                <ArrowRight className="mr-1.5 h-3.5 w-3.5" /> Transformar em oportunidade
              </Button>
            </div>
          );
        })}
      </div>

      {/* Opportunities */}
      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Target className="h-4 w-4 text-slate-400" /> Central de Oportunidades
      </h3>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {opportunities.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Nenhuma oportunidade</p>
            <p className="mt-1 text-xs text-slate-400">Converta insights em oportunidades ou crie manualmente.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Oportunidade</th>
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Responsável</th>
                  <th className="px-4 py-3 text-right font-medium">Valor</th>
                  <th className="px-4 py-3 text-center font-medium">Etapa</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => (
                  <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-medium text-slate-800">{o.title}</td>
                    <td className="px-4 py-3"><span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{SOURCE_LABELS[o.source] || o.source}</span></td>
                    <td className="px-4 py-3 text-slate-500">{o.customer_name || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{o.assignee || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">{fmtMoney(o.value)}</td>
                    <td className="px-4 py-3 text-center">
                      <select
                        value={o.stage}
                        onChange={(e) => updateStage(o, e.target.value)}
                        className={`rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STAGE_COLORS[o.stage]}`}
                      >
                        {Object.entries(STAGE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDelete(o)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><XCircle className="h-4 w-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Convert insight dialog */}
      <Dialog open={!!converting} onOpenChange={() => setConverting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Transformar em oportunidade</DialogTitle></DialogHeader>
          {converting && (
            <form onSubmit={submitConvert} className="space-y-3">
              <div className="rounded-lg bg-violet-50 p-3 text-xs text-violet-700">
                <p className="font-medium">{converting.title}</p>
                <p className="mt-1">{converting.description}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Título da oportunidade</Label>
                <Input name="title" defaultValue={converting.title} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Cliente</Label>
                  <Input name="customer_name" placeholder="Opcional" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Responsável</Label>
                  <Input name="assignee" placeholder="Opcional" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Valor estimado (R$)</Label>
                <Input name="value" type="number" step="0.01" defaultValue={typeof converting.current_value === 'number' ? converting.current_value : 0} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Descrição</Label>
                <Textarea name="description" rows={2} className="resize-none" defaultValue={converting.suggested_action} />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setConverting(null)}>Cancelar</Button>
                <Button type="submit">Criar oportunidade</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}