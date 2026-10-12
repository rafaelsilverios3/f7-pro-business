import React, { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { Bot, CheckCircle2, ExternalLink, Loader2, Send, ShieldCheck, Wrench } from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { buildAiSalesHistory } from '@/lib/aiSalesHistory';
import { aiSalesStatusPresentation } from '@/lib/aiSalesStatus';
import { AI_TOOL_NAMES } from '@/services/aiSalesTools';
import { aiSalesService } from '@/services/aiSalesService';

const SUGGESTIONS = ['Quais produtos temos?', 'Quanto temos em estoque?', 'Qual produto está sem estoque?', 'Procure um cliente pelo nome', 'Quais oportunidades comerciais tenho hoje?', 'Compare ofertas de fornecedores'];
function assistantModeLabel(mode) {
  if (mode === 'ai_generated') return 'Resposta gerada por IA · revise antes de agir';
  if (mode === 'factual_fallback') return 'Resposta factual do sistema · não gerada por IA';
  return null;
}

function statusFailure(cause, companyId, userId) {
  const denied = ['FEATURE_NOT_AVAILABLE', 'FORBIDDEN', 'AUTH_REQUIRED'].includes(cause?.code);
  return { state: denied ? 'denied' : 'unavailable', companyId, userId, errorCode: cause?.code || null, status_message: denied ? (cause?.message || 'Seu perfil ou plano não habilita o F7 AI Sales.') : null };
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

  const currentStatus = aiStatus.companyId === company?.id && aiStatus.userId === user?.id ? aiStatus : { state: 'checking' };
  const canUse = Boolean(user?.id && company?.id && currentStatus.state === 'ready' && currentStatus.can_use === true);
  const ownsConversation = conversationOwner === ownerKey;
  const visibleMessages = ownsConversation ? messages : [];
  const visiblePendingDraft = ownsConversation ? pendingDraft : null;
  const visibleSavedDraft = ownsConversation ? savedDraft : null;
  const history = useMemo(() => buildAiSalesHistory(visibleMessages), [visibleMessages]);
  const presentation = aiSalesStatusPresentation(currentStatus);

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
      setAiStatus(statusFailure(cause, company.id, user.id));
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
      const item = { role: 'assistant', answer: response.answer, tool: response.tool, data: response.data, context: response.context, actions: response.actions, generation_mode: response.generation_mode };
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
      setAiStatus(statusFailure(cause, company.id, user.id));
    });
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

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div><h2 className="font-semibold text-slate-800">Conversa comercial</h2><p className="text-xs text-slate-500">As ferramentas são selecionadas pelo servidor após validar a permissão do recurso.</p></div>
        <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${currentStatus.state === 'ready' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>
          {currentStatus.state === 'ready' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5" />}{presentation.label}
        </span>
      </div>
      <div className="max-h-[52vh] space-y-4 overflow-y-auto p-5">
        {visibleMessages.map((item, index) => <div key={`${index}-${item.role}`} className={item.role === 'user' ? 'ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm text-white' : 'max-w-[90%] rounded-2xl rounded-bl-md bg-slate-50 px-4 py-3 text-sm text-slate-700'}>
          <p className="whitespace-pre-wrap">{item.answer}</p>
          {item.tool && <p className="mt-2 text-[11px] text-slate-400">Ferramenta: {item.tool}</p>}
          {item.generation_mode && <p className="mt-1 text-[11px] text-slate-500">{assistantModeLabel(item.generation_mode)}</p>}
        </div>)}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Consultando dados autorizados...</div>}
      </div>
      <div className="border-t border-slate-100 p-4">
        <div className="mb-3 flex flex-wrap gap-2">{SUGGESTIONS.map((suggestion) => <button type="button" key={suggestion} onClick={() => send(suggestion)} disabled={busy || !canUse} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700 disabled:opacity-50">{suggestion}</button>)}</div>
        <form onSubmit={(event) => { event.preventDefault(); send(); }} className="flex gap-2">
          <input value={input} onChange={(event) => setInput(event.target.value)} disabled={busy || !canUse} placeholder="Converse com seu assistente comercial..." className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-indigo-500" />
          <Button type="submit" disabled={busy || !input.trim() || !canUse}><Send className="mr-2 h-4 w-4" />Enviar</Button>
        </form>
        {!canUse && <p className="mt-3 text-xs text-slate-500">A conversa está desabilitada até a autorização e as dependências serem confirmadas pelo servidor.</p>}
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </div>
    </section>

    {visiblePendingDraft && <section className="mt-4 rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h3 className="font-semibold text-indigo-900">Rascunho de pedido — confirmação necessária</h3><p className="mt-2 text-sm text-indigo-800">{visiblePendingDraft.quantity} x {visiblePendingDraft.product?.name} · R$ {Number(visiblePendingDraft.total || 0).toFixed(2).replace('.', ',')} · {visiblePendingDraft.customer?.name || 'cliente não informado'}</p><div className="mt-4 flex gap-2"><Button onClick={confirmDraft} disabled={busy || !canUse}>Confirmar criação do rascunho</Button><Button variant="outline" onClick={() => setPendingDraft(null)} disabled={busy}>Cancelar</Button></div></section>}
    {visibleSavedDraft && <p className="mt-3 text-xs text-emerald-700">Rascunho salvo: {visibleSavedDraft.id}</p>}

    <div className="mt-5 grid gap-4 md:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><Wrench className="h-4 w-4 text-indigo-600" /> Ferramentas controladas</h2><p className="mt-1 text-xs text-slate-500">Cada consulta exige a permissão do módulo correspondente.</p><div className="mt-4 grid gap-2 sm:grid-cols-2">{AI_TOOL_NAMES.map((tool) => <div key={tool} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{tool.replaceAll('_', ' ')}</div>)}</div></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600" /> Segurança</h2><ul className="mt-4 space-y-2 text-xs text-slate-600"><li>• Sem SQL arbitrário nem acesso direto do navegador ao banco.</li><li>• E-mails, telefones e documentos não são enviados ao provedor de IA.</li><li>• Ofertas só entram na simulação se aprovadas, verificadas, vigentes, da empresa/produto ativos e em BRL.</li><li>• Disponibilidade declarada por fornecedor não se mistura ao estoque próprio.</li><li>• Rascunhos exigem confirmação e não baixam estoque; nenhuma outra escrita é oferecida.</li></ul>{visibleSavedDraft && <button type="button" onClick={() => navigate('/vendas')} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">Abrir vendas <ExternalLink className="h-3 w-3" /></button>}</section>
    </div>
  </div>;
}
