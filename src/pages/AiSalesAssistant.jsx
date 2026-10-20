import React, { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { AlertCircle, Bot, Check, CheckCircle2, Copy, ExternalLink, Loader2, Send, ShieldCheck, Wrench } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { buildAiSalesHistory } from '@/lib/aiSalesHistory';
import { aiSalesStatusFromError, aiSalesStatusPresentation } from '@/lib/aiSalesStatus';
import { AI_TOOL_NAMES } from '@/services/aiSalesTools';
import { aiSalesService } from '@/services/aiSalesService';
import { can } from '@/lib/permissions';

const SUGGESTIONS = [
  { text: 'Quais produtos temos?', permissions: ['catalog.view'] },
  { text: 'Quanto temos em estoque?', permissions: ['catalog.view'] },
  { text: 'Analise as vendas dos últimos 30 dias', permissions: ['sales.view'] },
  { text: 'Quais oportunidades comerciais temos?', permissions: ['opportunity.view'] },
  { text: 'Escreva uma mensagem de apresentação comercial', permissions: ['ai_sales.use'] },
  { text: 'Como melhorar a conversão de vendas?', permissions: ['ai_sales.use'] },
  { text: 'Compare ofertas de fornecedores', permissions: ['catalog.view', 'purchases.view', 'pricing.view'] },
  { text: 'Encontre novos fornecedores', permissions: ['supplier_intelligence.view'] },
];
const TOOL_LABELS = { buscar_produto: 'Consulta ao catálogo', consultar_estoque: 'Consulta de estoque', consultar_preco: 'Consulta de preço', buscar_cliente: 'Consulta de clientes', consultar_pedido: 'Consulta de pedido', buscar_oportunidades: 'Análise de oportunidades', analisar_vendas: 'Análise de vendas · últimos 30 dias', analisar_ofertas_fornecedor: 'Análise de ofertas cadastradas', redigir_mensagem: 'Rascunho de texto comercial', orientacao_comercial: 'Orientação geral', consultar_fornecedor: 'Supplier Intelligence' };
function assistantModeLabel(mode) {
  if (mode === 'ai_generated') return 'Resposta gerada por IA · revise antes de agir';
  if (mode === 'factual_fallback') return 'Resposta factual do sistema · não gerada por IA';
  return null;
}

export default function AiSalesAssistant() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const ownerKey = `${company?.id || ''}:${user?.id || ''}`;
  const ownerRef = useRef(ownerKey);
  ownerRef.current = ownerKey;
  const [conversationOwner, setConversationOwner] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingDraft, setPendingDraft] = useState(null);
  const [savedDraft, setSavedDraft] = useState(null);
  const [routeContext, setRouteContext] = useState({});
  const [aiStatus, setAiStatus] = useState({ state: 'checking', companyId: null, userId: null });
  const [copiedMessage, setCopiedMessage] = useState(null);

  const currentStatus = aiStatus.companyId === company?.id && aiStatus.userId === user?.id ? aiStatus : { state: 'checking' };
  const canUse = Boolean(user?.id && company?.id && currentStatus.state === 'ready' && currentStatus.can_use === true);
  const ownsConversation = conversationOwner === ownerKey;
  const visibleMessages = ownsConversation ? messages : [];
  const visiblePendingDraft = ownsConversation ? pendingDraft : null;
  const visibleSavedDraft = ownsConversation ? savedDraft : null;
  const history = useMemo(() => buildAiSalesHistory(visibleMessages), [visibleMessages]);
  const presentation = aiSalesStatusPresentation(currentStatus);
  const availableSuggestions = SUGGESTIONS.filter((item) => item.permissions.every((permission) => can(user, permission)));

  React.useEffect(() => {
    let cancelled = false;
    const nextOwnerKey = `${company?.id || ''}:${user?.id || ''}`;
    setConversationOwner(nextOwnerKey);
    setMessages([]);
    setInput('');
    setBusy(false);
    setError('');
    setPendingDraft(null);
    setSavedDraft(null);
    setRouteContext({});
    setAiStatus({ state: 'checking', companyId: company?.id || null, userId: user?.id || null });

    if (!company?.id || !user?.id) {
      setAiStatus({ state: 'unavailable', companyId: company?.id || null, userId: user?.id || null });
      return () => { cancelled = true; };
    }

    aiSalesService.status(company.id).then((result) => {
      if (cancelled || ownerRef.current !== nextOwnerKey) return;
      setAiStatus({ ...result, state: result?.can_use ? 'ready' : 'denied', companyId: company.id, userId: user.id });
    }).catch((cause) => {
      if (cancelled || ownerRef.current !== nextOwnerKey) return;
      setAiStatus(aiSalesStatusFromError(cause, company.id, user.id));
    });
    return () => { cancelled = true; };
  }, [company?.id, user?.id]);

  React.useEffect(() => {
    const prefill = location.state?.prefill || new URLSearchParams(location.search).get('query');
    const incomingContext = location.state?.context || {};
    if (prefill) setInput(prefill);
    if (Object.keys(incomingContext).length) setRouteContext(incomingContext);
    if (prefill || Object.keys(incomingContext).length) navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, navigate]);

  const send = async (value = input) => {
    const message = String(value || '').trim();
    if (!message || busy || !canUse || ownerRef.current !== ownerKey) return;
    setConversationOwner(ownerKey);
    setBusy(true);
    setError('');
    setInput('');
    setMessages((current) => [...(conversationOwner === ownerKey ? current : []), { role: 'user', answer: message }]);
    try {
      const response = await aiSalesService.chat(company.id, message, history, routeContext);
      if (ownerRef.current !== ownerKey) return;
      const item = { role: 'assistant', answer: response.answer, follow_up: response.follow_up, notices: response.notices, tool: response.tool, data: response.data, context: response.context, actions: response.actions, generation_mode: response.generation_mode };
      setMessages((current) => [...current, item]);
      if (response.actions?.can_create_draft) setPendingDraft({ ...response.data, ...response.context, idempotency_key: crypto.randomUUID() });
      if (response.actions?.open_supplier_intelligence) navigate('/supplier-intelligence', { state: { query: message, context: { ...routeContext, ...response.context, source_module: 'ai_sales', intent: 'supplier_research' } } });
    } catch (cause) {
      if (ownerRef.current === ownerKey) setError(cause.message || 'Não foi possível consultar o assistente.');
    } finally {
      if (ownerRef.current === ownerKey) setBusy(false);
    }
  };

  const confirmDraft = async () => {
    if (!visiblePendingDraft || busy || !canUse || ownerRef.current !== ownerKey) return;
    setBusy(true);
    setError('');
    try {
      const response = await aiSalesService.createDraft(company.id, { product_id: visiblePendingDraft.product?.id, customer_id: visiblePendingDraft.customer?.id, quantity: visiblePendingDraft.quantity, idempotency_key: visiblePendingDraft.idempotency_key });
      if (ownerRef.current !== ownerKey) return;
      setSavedDraft(response.draft);
      setPendingDraft(null);
      setMessages((current) => [...current, { role: 'assistant', answer: `Rascunho criado com sucesso. O pedido ${response.draft.id} permanece em RASCUNHO e não alterou o estoque.`, tool: 'criar_rascunho_pedido', generation_mode: 'factual_fallback' }]);
    } catch (cause) {
      if (ownerRef.current === ownerKey) setError(cause.message || 'Não foi possível criar o rascunho.');
    } finally {
      if (ownerRef.current === ownerKey) setBusy(false);
    }
  };

  const retryStatus = () => {
    if (!company?.id || !user?.id) return;
    setAiStatus({ state: 'checking', companyId: company.id, userId: user.id });
    aiSalesService.status(company.id).then((result) => {
      if (ownerRef.current !== ownerKey) return;
      setAiStatus({ ...result, state: result?.can_use ? 'ready' : 'denied', companyId: company.id, userId: user.id });
    }).catch((cause) => {
      if (ownerRef.current !== ownerKey) return;
      setAiStatus(aiSalesStatusFromError(cause, company.id, user.id));
    });
  };

  const copyAnswer = async (answer, index) => {
    try { await navigator.clipboard.writeText(answer); setCopiedMessage(index); window.setTimeout(() => setCopiedMessage(null), 1800); }
    catch { setError('Não foi possível copiar. Selecione o texto e copie manualmente.'); }
  };

  return <div className="mx-auto max-w-5xl px-5 py-8">
    <PageHeader title="F7 AI Sales Assistant" subtitle="Análise comercial com dados autorizados da empresa ativa." />
    <div className={`mb-5 flex items-start gap-3 rounded-2xl border p-4 text-sm ${presentation.tone}`}>
      <Bot className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="font-semibold">{presentation.label}{currentStatus.state === 'ready' ? ` · ${company?.name || 'empresa ativa'}` : ''}</p>
        <p className="mt-1 text-xs">{presentation.message}</p>
        {currentStatus.state === 'unavailable' && <button type="button" onClick={retryStatus} className="mt-2 text-xs font-semibold underline">Verificar novamente</button>}
        <p className="mt-2 text-xs">F7 AI Sales é separado do Smart Atendimento. O backend valida empresa, papel, plano e permissão do recurso; ações persistentes continuam restritas ao rascunho confirmado por uma pessoa.</p>
      </div>
    </div>

    <section className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div><h2 className="font-semibold">Conversa comercial</h2><p className="text-xs text-muted-foreground">Consulte dados reais, peça análises ou crie rascunhos de texto. A empresa ativa e as permissões são validadas pelo servidor.</p></div>
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${currentStatus.state === 'ready' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
          {currentStatus.state === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : currentStatus.state === 'checking' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}{presentation.label}
        </span>
      </div>
      <div aria-live="polite" className="max-h-[52vh] space-y-4 overflow-y-auto p-5">
        {visibleMessages.map((item, index) => <article key={`${index}-${item.role}`} className={item.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm text-primary-foreground' : 'max-w-full rounded-2xl rounded-bl-md border border-border bg-card px-4 py-4 text-sm text-card-foreground shadow-sm'}>
          {item.role === 'assistant' ? <div className="space-y-3 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:leading-6 [&_strong]:font-semibold"><ReactMarkdown>{item.answer}</ReactMarkdown></div> : <p className="whitespace-pre-wrap">{item.answer}</p>}
          {item.follow_up && <p className="mt-3 rounded-lg border border-border bg-muted/60 p-3 text-xs leading-5"><span className="font-semibold">Próximo passo: </span>{item.follow_up}</p>}
          {item.notices?.data_dependencies?.length > 0 && <p className="mt-3 text-xs text-muted-foreground">Base: {item.notices.data_dependencies.join(' · ')}</p>}
          {item.notices?.external_research_used && <p className="mt-1 text-xs text-muted-foreground">Pesquisa externa utilizada; confira as fontes antes de decidir.</p>}
          {item.tool && <p className="mt-3 text-xs text-muted-foreground">{TOOL_LABELS[item.tool] || item.tool.replaceAll('_', ' ')}</p>}
          {item.generation_mode && <p className="mt-1 text-xs text-muted-foreground">{assistantModeLabel(item.generation_mode)}</p>}
          {item.role === 'assistant' && <button type="button" onClick={() => copyAnswer(item.answer, index)} className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Copiar resposta"><>{copiedMessage === index ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}{copiedMessage === index ? 'Copiado' : 'Copiar texto'}</></button>}
        </article>)}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Consultando dados autorizados...</div>}
      </div>
      <div className="border-t border-border p-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Sugestões disponíveis para seu perfil</p><div className="mb-3 flex flex-wrap gap-2">{availableSuggestions.map(({ text: suggestion }) => <button type="button" key={suggestion} onClick={() => send(suggestion)} disabled={busy || !canUse} className="min-h-9 rounded-full border border-border px-3 py-1.5 text-xs text-foreground hover:border-primary hover:bg-accent disabled:opacity-50">{suggestion}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2">
          <input value={input} onChange={(event) => setInput(event.target.value)} disabled={busy || !canUse} placeholder="Converse com seu assistente comercial..." className="min-h-11 min-w-0 flex-1 rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" disabled={busy || !input.trim() || !canUse}><Send className="mr-2 h-4 w-4" />Enviar</Button>
        </form>
        {!canUse && <p className="mt-3 text-xs text-slate-500">{currentStatus.state === 'maintenance' ? 'A conversa permanece desabilitada durante a manutenção.' : 'A conversa está desabilitada até a autorização e as dependências serem confirmadas pelo servidor.'}</p>}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>
    </section>

    {visiblePendingDraft && <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h3 className="font-semibold text-indigo-900">Rascunho de pedido — confirmação necessária</h3><p className="mt-2 text-sm text-indigo-800">{visiblePendingDraft.quantity} x {visiblePendingDraft.product?.name} · R$ {Number(visiblePendingDraft.total || 0).toFixed(2).replace('.', ',')} · {visiblePendingDraft.customer?.name || 'cliente não informado'}</p><div className="mt-4 flex gap-2"><Button onClick={confirmDraft} disabled={busy || !canUse}>Confirmar criação do rascunho</Button><Button variant="outline" onClick={() => setPendingDraft(null)} disabled={busy}>Cancelar</Button></div></section>}
    {visibleSavedDraft && <p className="mt-3 text-xs text-emerald-700">Rascunho salvo: {visibleSavedDraft.id}</p>}

    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground"><h2 className="flex items-center gap-2 font-semibold"><Wrench className="h-4 w-4 text-primary" /> Ferramentas controladas</h2><p className="mt-1 text-xs text-muted-foreground">Cada consulta exige a permissão do módulo correspondente.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{AI_TOOL_NAMES.map((tool) => <div key={tool} className="rounded-lg bg-muted px-3 py-2 text-xs text-foreground">{TOOL_LABELS[tool] || tool.replaceAll('_', ' ')}</div>)}</div></section>
      <section className="rounded-2xl border border-border bg-card p-5 text-card-foreground"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Segurança</h2><ul className="mt-4 space-y-2 text-xs text-muted-foreground"><li>• Sem SQL arbitrário nem acesso direto do navegador ao banco.</li><li>• E-mails, telefones e documentos são removidos do pedido antes do envio ao provedor.</li><li>• Dados reais só entram quando a consulta exige cadastro e a permissão correspondente foi validada.</li><li>• Pesquisa externa ocorre no Supplier Intelligence; resultados externos não são apresentados como dados internos.</li><li>• Rascunhos de pedido exigem confirmação humana e não baixam estoque; nenhuma mensagem é enviada pelo assistente.</li></ul>{visibleSavedDraft && <button type="button" onClick={() => navigate('/vendas')} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary">Abrir vendas <ExternalLink className="h-3 w-3" /></button>}</section>
    </div>
  </div>;
}
