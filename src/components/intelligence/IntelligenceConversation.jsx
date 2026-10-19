import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowUp, ExternalLink, Loader2, Plus, Search, Sparkles } from 'lucide-react';
import { intelligenceService } from '@/services/intelligenceService';
import { opportunityFoundationService } from '@/services/opportunityFoundationService';
import { buildModuleContext, contextSummary } from '@/lib/moduleContext';
import { Button } from '@/components/ui/button';
import AICreditConfirmationDialog from '@/components/ai/AICreditConfirmationDialog';
import { aiCreditsService } from '@/services/aiCreditsService';
import { useAuth } from '@/lib/AuthContext';
import AICreditsWallet from '@/components/ai/AICreditsWallet';

const SUGGESTIONS = ['Analisar meu negócio', 'Encontrar oportunidades', 'Pesquisar mercado', 'Encontrar fornecedores', 'Analisar meu estoque', 'Encontrar clientes com potencial'];
const MODE_LABELS = { internal: 'INTERNO', external: 'EXTERNO', hybrid: 'HÍBRIDO' };

export default function IntelligenceConversation({ company }) {
  const navigate = useNavigate(); const location = useLocation();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState({});
  const [routeContext, setRouteContext] = useState({});
  const [creditQuote, setCreditQuote] = useState(null);
  const [pendingRequest, setPendingRequest] = useState(null);
  React.useEffect(() => { const incoming = location.state?.query || new URLSearchParams(location.search).get('query'); const incomingContext = location.state?.context || {}; if (incoming) setQuery(incoming); if (Object.keys(incomingContext).length) setRouteContext(incomingContext); if (incoming || Object.keys(incomingContext).length) navigate(location.pathname, { replace: true, state: null }); }, [location.pathname, location.search, location.state, navigate]);

  const ask = async (value = query, approved = null) => {
    const pending = approved || { text: String(value || '').trim(), requestId: crypto.randomUUID(), history: messages.slice(-4).map((item) => ({ query: item.query, answer: item.result.answer, mode: item.result.mode })), context: routeContext };
    const text = pending.text;
    if (!text || loading || !company?.id) return;
    setQuery(''); setError(''); setLoading(true);
    try {
      const result = await intelligenceService.query(company.id, text, pending.history, pending.context, { requestId: pending.requestId, ...(approved ? { quoteId: approved.quoteId, confirmed: true } : {}) });
      setMessages((current) => [...current, { query: text, result }]);
      setPendingRequest(null); setCreditQuote(null);
    } catch (cause) {
      if (cause.code === 'AI_CREDITS_CONFIRMATION_REQUIRED' && cause.aiCreditQuote?.quote_id) {
        setPendingRequest({ ...pending, quoteId: cause.aiCreditQuote.quote_id }); setCreditQuote(cause.aiCreditQuote);
      } else setError(cause.message || 'Não foi possível concluir a análise.');
    }
    finally { setLoading(false); }
  };

  const cancelCreditQuote = async () => {
    const quoteId = pendingRequest?.quoteId;
    setCreditQuote(null); setPendingRequest(null);
    if (quoteId) { try { await aiCreditsService.cancelQuote(company.id, quoteId); } catch { /* server expires unused quotes; no provider call occurs */ } }
  };

  const saveOpportunity = async (item, messageIndex) => {
    try {
      const evidence = Array.isArray(item.evidence) ? item.evidence : [];
      const sourceUrl = evidence.find((entry) => entry?.url)?.url || '';
      const partNumber = item.part_number || null;
      await opportunityFoundationService.create(company.id, { title: item.title || partNumber || 'Oportunidade identificada', description: evidence[0]?.text || 'Oportunidade identificada pela F7 Intelligence.', source: 'intelligence', source_type: 'EXTERNA', source_url: sourceUrl, metadata: { source_module: 'intelligence', part_number: partNumber, evidence, entity_type: 'product', entity_id: routeContext.product_id || null, radar_state: 'NOVA', dedup_key: `intelligence:${partNumber || item.title || sourceUrl || 'opportunity'}:${sourceUrl || 'no-source'}` }, value: 0, stage: 'new' });
      setSaved((current) => ({ ...current, [`${messageIndex}-${item.part_number}`]: true }));
    } catch (cause) { setError(cause.message || 'Não foi possível salvar a oportunidade.'); }
  };

  const followUp = (prompt, asked) => ask(`${prompt} Contexto da análise anterior: ${asked}`);
  const openSupplierSearch = (asked) => navigate('/supplier-intelligence', { state: { query: asked, context: buildModuleContext({ item: { ...routeContext, id: routeContext.opportunity_id, metadata: routeContext }, sourceModule: 'intelligence', intent: 'supplier_research' }) } });

  return <><AICreditsWallet companyId={company?.id} email={user?.email} /><AICreditConfirmationDialog quote={creditQuote} busy={loading} onCancel={cancelCreditQuote} onConfirm={() => pendingRequest && ask('', pendingRequest)} /><section className="mb-6 overflow-hidden rounded-2xl border border-indigo-200 bg-gradient-to-br from-[#0e1a2b] via-[#182b52] to-indigo-900 text-white shadow-lg">
    <div className="p-5 sm:p-6">
      <div className="flex items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-400/20"><Sparkles className="h-5 w-5 text-indigo-200" /></div><div><h2 className="text-lg font-semibold">Como posso ajudar sua empresa hoje?</h2><p className="mt-1 text-xs text-indigo-100/80">Converse com a F7 Intelligence usando os dados autorizados da sua empresa.</p>{Object.keys(routeContext).length > 0 && <p className="mt-2 text-[11px] text-indigo-200">Contexto recebido de {routeContext.source_module || 'outro módulo'} · {contextSummary(routeContext).opportunity_id ? 'oportunidade vinculada' : 'entidade vinculada'}</p>}</div></div>
      <form className="mt-5 flex gap-2" onSubmit={(event) => { event.preventDefault(); ask(); }}><input value={query} onChange={(event) => setQuery(event.target.value)} disabled={loading} placeholder="Pergunte à F7 Intelligence..." className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-indigo-100/60 focus:border-indigo-300" /><Button type="submit" disabled={loading || !query.trim()} className="shrink-0 bg-indigo-400 text-slate-950 hover:bg-indigo-300">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}</Button></form>
      <div className="mt-3 flex flex-wrap gap-2">{SUGGESTIONS.map((item) => <button type="button" key={item} disabled={loading} onClick={() => ask(item)} className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-indigo-100 transition hover:bg-white/15">{item}</button>)}</div>
    </div>
    {error && <p className="border-t border-rose-300/20 bg-rose-500/20 px-5 py-3 text-xs text-rose-100">{error}</p>}
    {messages.length > 0 && <div className="space-y-4 border-t border-white/10 bg-slate-950/20 p-5">{messages.map(({ query: asked, result }, index) => <article key={`${index}-${asked}`} className="rounded-xl border border-white/10 bg-white/[.06] p-4">
      <p className="text-xs font-medium text-indigo-200">Você perguntou: {asked}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2"><span className="rounded-full bg-indigo-300/20 px-2 py-1 text-[10px] font-semibold text-indigo-100">{MODE_LABELS[result.mode] || result.mode}</span><span className="rounded-full bg-white/10 px-2 py-1 text-[10px] text-indigo-100">Confiança: {result.confidence || 'BAIXA'}</span></div>
      <p className="mt-3 text-sm leading-6 text-white/90">{result.answer}</p>
      {result.analysis?.insights?.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-indigo-100">Insights</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-indigo-100/85">{result.analysis.insights.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {result.analysis?.recommendations?.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-indigo-100">Recomendações</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-indigo-100/85">{result.analysis.recommendations.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {result.analysis?.risks?.length > 0 && <div className="mt-4 rounded-lg bg-rose-400/10 p-3"><p className="text-xs font-semibold text-rose-100">Riscos</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-rose-100/85">{result.analysis.risks.map((item) => <li key={item}>{item}</li>)}</ul></div>}
      {result.external?.status === 'unavailable' && <p className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100"><Search className="h-3.5 w-3.5" /> Pesquisa externa ainda não configurada.</p>}
      {result.external?.sources?.length > 0 && <div className="mt-4"><p className="text-xs font-semibold text-indigo-100">Fontes consultadas ({result.external.sources.length})</p><ul className="mt-2 space-y-1.5">{result.external.sources.slice(0, 5).map((source) => <li key={source.url}><a href={source.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-xs text-indigo-200 hover:text-white"><ExternalLink className="h-3 w-3 shrink-0" />{source.title || source.url}</a></li>)}</ul></div>}
      {result.mode !== 'internal' && (!result.external?.candidates || result.external.candidates.length === 0) && <div className="mt-4"><Button type="button" size="sm" variant="outline" onClick={() => openSupplierSearch(asked)} className="border-white/20 bg-transparent text-white">Pesquisar fornecedores</Button></div>}
      {result.external?.candidates?.length > 0 && <div className="mt-4 space-y-2"><p className="text-xs font-semibold text-indigo-100">Oportunidades identificadas</p>{result.external.candidates.map((item) => { const key = `${index}-${item.part_number}`; return <div key={key} className="rounded-lg border border-white/10 bg-black/10 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold">{item.title || item.part_number}</p><Button type="button" size="sm" variant="outline" disabled={saved[key]} onClick={() => saveOpportunity(item, index)} className="border-white/20 bg-transparent text-white">{saved[key] ? 'Salva' : <><Plus className="mr-1 h-3 w-3" /> Salvar oportunidade</>}</Button></div><p className="mt-1 text-xs text-indigo-100/75">Confiança: {item.confidence ?? 'indisponível'} · Fontes: {item.source_count || 0}</p></div>; })}<div className="flex flex-wrap gap-2 pt-1"><Button type="button" size="sm" variant="outline" disabled={loading} onClick={() => followUp('Aprofunde a análise com novas evidências e riscos, sem inventar dados.', asked)} className="border-white/20 bg-transparent text-white">Aprofundar análise</Button><Button type="button" size="sm" variant="outline" onClick={() => openSupplierSearch(asked)} className="border-white/20 bg-transparent text-white">Pesquisar fornecedores</Button></div></div>}
    </article>)}</div>}
  </section></>;
}
