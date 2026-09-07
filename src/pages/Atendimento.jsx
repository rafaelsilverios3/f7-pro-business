import React, { useState, useEffect, useRef } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Plus, Send, Bot, User, Headset, MessageSquare, AlertCircle, Sparkles, UserPlus, Search, ShoppingCart, CheckCircle2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { conversationsService } from '@/services/conversationsService';
import { opportunitiesService } from '@/services/opportunitiesService';
import { getDataProvider } from '@/data/providerSelector';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { searchCatalog } from '@/services/smartCatalogService';
import { createConversationDraft, finalizeConfirmedConversationOrder } from '@/services/conversationOrderService';
import { useAuth } from '@/lib/AuthContext';
import { can } from '@/lib/permissions';

const STATUS_STYLE = {
  ai_assisting: 'bg-violet-100 text-violet-700',
  waiting_human: 'bg-amber-100 text-amber-700',
  in_progress: 'bg-blue-100 text-blue-700',
  opportunity: 'bg-emerald-100 text-emerald-700',
  finished: 'bg-slate-200 text-slate-600',
};
const STATUS_LABEL = {
  ai_assisting: 'IA Atendendo',
  waiting_human: 'Aguardando Humano',
  in_progress: 'Em Atendimento',
  opportunity: 'Oportunidade',
  finished: 'Finalizado',
};
const CHANNEL_LABELS = {
  whatsapp: 'WhatsApp', site: 'Site', instagram: 'Instagram', telegram: 'Telegram', manual: 'Manual',
};
const CHANNEL_CONFIGURED = {
  whatsapp: false, site: false, instagram: false, telegram: false, manual: true,
};

export default function Atendimento() {
  const { company } = useOutletContext();
  const { user } = useAuth();
  const [conversations, setConversations] = useState(null);
  const [selected, setSelected] = useState(null);
  const [newDialog, setNewDialog] = useState(false);
  const [message, setMessage] = useState('');
  const [aiThinking, setAiThinking] = useState(false);
  const [products, setProducts] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogOptions, setCatalogOptions] = useState([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [draft, setDraft] = useState(null);
  const [draftQuantity, setDraftQuantity] = useState(1);
  const [orderConfirmed, setOrderConfirmed] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const chatRef = useRef(null);

  const load = async () => {
    if (!company) return;
    const [convs, prods] = await Promise.all([
      import.meta.env.VITE_DATA_PROVIDER === 'supabase' ? conversationsService.list(company.id) : base44.entities.Conversation.filter({ company_id: company.id }, '-last_message_at', 200),
      getDataProvider().entity('Product').list({ company_id: company.id, active: true }, '-name', 200),
    ]);
    setConversations(convs);
    setProducts(prods);
    if (selected) {
      const updated = convs.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  };
  useEffect(() => { load(); }, [company]);

  const searchProducts = async (event) => {
    event?.preventDefault();
    if (!company) return;
    setCatalogLoading(true); setCatalogError('');
    try { setCatalogOptions(await searchCatalog(company.id, { query: catalogQuery, inStock: true, activeOnly: true })); }
    catch (error) { setCatalogError(error.message || 'Não foi possível consultar o catálogo.'); }
    finally { setCatalogLoading(false); }
  };

  const selectProduct = (option) => {
    if (!can(user, 'orders.create_from_conversation')) { setCatalogError('Seu perfil pode consultar o catálogo, mas não pode criar pedidos pelo atendimento.'); return; }
    try {
      setDraft(createConversationDraft({ companyId: company.id, conversationId: selected?.id, customerId: selected?.customer_id, option, quantity: draftQuantity }));
      setOrderConfirmed(false);
    } catch (error) { setCatalogError(error.message); }
  };

  const confirmOrder = async () => {
    if (!draft || !orderConfirmed) return;
    setOrderLoading(true); setCatalogError('');
    try { await finalizeConfirmedConversationOrder({ draft, confirmed: true, idempotencyKey: `conversation:${draft.conversation_id || 'manual'}:${draft.items[0].product_id}:${draft.created_at}` }); setDraft(null); alert('Pedido confirmado e venda registrada.'); await load(); }
    catch (error) { setCatalogError(error.message || 'Não foi possível confirmar o pedido.'); }
    finally { setOrderLoading(false); }
  };

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [selected?.messages, aiThinking]);

  const handleSelect = (c) => {
    setSelected(c);
    if (c.status === 'waiting_human' || c.status === 'ai_assisting') {
      (import.meta.env.VITE_DATA_PROVIDER === 'supabase'
        ? conversationsService.update(company.id, c.id, { status: 'in_progress', assignee: c.assignee || 'Você' })
        : base44.entities.Conversation.update(c.id, { status: 'in_progress', assignee: c.assignee || 'Você' })).then(() => load());
    }
  };

  const sendMessage = async (e) => {
    e?.preventDefault();
    if (!message.trim() || !selected) return;
    const text = message.trim();
    const now = new Date().toISOString();
    const msg = { sender: 'agent', text, timestamp: now };
    const newMessages = [...(selected.messages || []), msg];
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') {
      await conversationsService.addMessage(company.id, selected.id, { sender: 'agent', content: text, message_type: 'text', created_at: now });
      await conversationsService.update(company.id, selected.id, { last_message_at: now, status: 'in_progress' });
    } else await base44.entities.Conversation.update(selected.id, { messages: newMessages, last_message_at: now, status: 'in_progress' });
    setMessage('');
    load();
  };

  const aiRespond = async () => {
    if (!selected) return;
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') { alert('A resposta por IA será habilitada após a integração segura do provedor de IA.'); return; }
    setAiThinking(true);
    try {
      const lastMessages = (selected.messages || []).slice(-6).map((m) => `${m.sender}: ${m.text}`).join('\n');
      const productList = products.slice(0, 20).map((p) => `${p.name} - ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.sale_price)} (estoque: ${p.stock})`).join('\n');
      const prompt = `Você é a assistente virtual da empresa ${company?.name || ''}. Responda o cliente de forma breve e útil. Dados disponíveis:\nProdutos:\n${productList}\n\nHistórico:\n${lastMessages}\n\nResponda a última mensagem do cliente:`;
      const res = await base44.integrations.Core.InvokeLLM({
        prompt,
        response_json_schema: { type: 'object', properties: { reply: { type: 'string' }, should_transfer: { type: 'boolean' }, create_lead: { type: 'boolean' } } },
      });
      const now = new Date().toISOString();
      const aiMsg = { sender: 'ai', text: res.reply || 'Como posso ajudar?', timestamp: now };
      const newMessages = [...(selected.messages || []), aiMsg];
      const updates = { messages: newMessages, last_message_at: now };
      if (res.should_transfer) {
        updates.status = 'waiting_human';
        updates.ai_enabled = false;
      }
      await base44.entities.Conversation.update(selected.id, updates);
      if (res.create_lead && selected.customer_name) {
        await base44.entities.Opportunity.create({
          company_id: company.id,
          title: `Oportunidade — ${selected.customer_name}`,
          description: `Gerada pelo atendimento via ${CHANNEL_LABELS[selected.channel]}.`,
          source: 'atendimento',
          customer_name: selected.customer_name,
          conversation_id: selected.id,
          stage: 'new',
        });
      }
      load();
    } catch {
      const now = new Date().toISOString();
      const fallback = { sender: 'ai', text: 'Desculpe, não consegui processar agora. Um atendente humano continuará o atendimento.', timestamp: now };
      const newMessages = [...(selected.messages || []), fallback];
      await base44.entities.Conversation.update(selected.id, { messages: newMessages, last_message_at: now, status: 'waiting_human', ai_enabled: false });
      load();
    }
    setAiThinking(false);
  };

  const transferToHuman = async () => {
    if (!selected) return;
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await conversationsService.update(company.id, selected.id, { status: 'waiting_human', ai_enabled: false });
    else await base44.entities.Conversation.update(selected.id, { status: 'waiting_human', ai_enabled: false });
    load();
  };

  const finishConversation = async () => {
    if (!selected) return;
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await conversationsService.update(company.id, selected.id, { status: 'finished' });
    else await base44.entities.Conversation.update(selected.id, { status: 'finished' });
    load();
  };

  const createOpportunity = async () => {
    if (!selected) return;
    const payload = {
      company_id: company.id,
      title: `Oportunidade — ${selected.customer_name}`,
      description: `Gerada manualmente a partir do atendimento.`,
      source: 'atendimento',
      customer_name: selected.customer_name,
      conversation_id: selected.id,
      stage: 'new',
    };
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await opportunitiesService.create(company.id, payload);
    else await base44.entities.Opportunity.create(payload);
    if (import.meta.env.VITE_DATA_PROVIDER === 'supabase') await conversationsService.update(company.id, selected.id, { status: 'opportunity' });
    else await base44.entities.Conversation.update(selected.id, { status: 'opportunity' });
    alert('Oportunidade criada!');
    load();
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col px-5 py-8" style={{ height: 'calc(100vh - 1rem)' }}>
      <PageHeader
        title="F7 Smart Atendimento"
        subtitle="Central omnichannel com IA integrada ao seu CRM e catálogo."
        action={<Button onClick={() => setNewDialog(true)}><Plus className="mr-1.5 h-4 w-4" /> Nova conversa</Button>}
      />

      <div className="mb-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
        <AlertCircle className="h-4 w-4 shrink-0" />
        <span>Canais externos (WhatsApp, Instagram, Telegram) ainda não estão configurados. Conversas manuais e por IA estão ativas. Configure a integração em Configurações.</span>
      </div>

      <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><ShoppingCart className="h-4 w-4 text-indigo-600" /> Catálogo da empresa</h2><p className="text-xs text-slate-400">Consulte produtos reais e monte um pedido para confirmação.</p></div><span className="text-[11px] text-slate-400">Sem venda automática</span></div>
        <form onSubmit={searchProducts} className="flex gap-2"><Input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="Buscar por nome, categoria, marca, tamanho ou cor..." /><Button type="submit" variant="outline" disabled={catalogLoading}><Search className="mr-1.5 h-4 w-4" /> {catalogLoading ? 'Buscando' : 'Buscar'}</Button></form>
        {catalogError && <p className="mt-2 text-xs text-rose-600">{catalogError}</p>}
        {catalogOptions.length > 0 && <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">{catalogOptions.map((option) => <div key={option.id} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3"><div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-slate-200">{option.images?.[0]?.url ? <img src={option.images[0].url} alt={option.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-[10px] text-slate-400">Sem foto</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-slate-800">{option.selection_number}. {option.name}</p><p className="truncate text-[11px] text-slate-500">{option.short_description || 'Produto do catálogo'}</p><p className="mt-1 text-xs font-semibold text-indigo-600">R$ {option.price.toFixed(2).replace('.', ',')} · {option.stock} disponíveis</p><Button type="button" size="sm" className="mt-2 h-7 text-[11px]" onClick={() => selectProduct(option)}>Adicionar ao pedido</Button></div></div>)}</div>}
        {catalogOptions.length === 0 && catalogQuery && !catalogLoading && <p className="mt-3 text-xs text-slate-400">Nenhum produto disponível para essa busca.</p>}
        {draft && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3"><div className="flex-1 text-xs text-indigo-900"><strong>Rascunho:</strong> {draft.items[0].name} × {draft.items[0].qty} — R$ {draft.total.toFixed(2).replace('.', ',')}</div><label className="flex items-center gap-2 text-xs text-indigo-800"><input type="checkbox" checked={orderConfirmed} onChange={(event) => setOrderConfirmed(event.target.checked)} /> Confirmo o pedido antes de finalizar</label><Button type="button" size="sm" disabled={!orderConfirmed || orderLoading} onClick={confirmOrder}><CheckCircle2 className="mr-1 h-3.5 w-3.5" /> {orderLoading ? 'Confirmando...' : 'Confirmar pedido'}</Button></div>}
      </div>

      <div className="flex flex-1 gap-4 overflow-hidden">
        {/* Conversation list */}
        <div className="w-72 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {conversations === null ? (
            <div className="p-8 text-center text-sm text-slate-400">Carregando...</div>
          ) : conversations.length === 0 ? (
            <div className="p-8 text-center">
              <MessageSquare className="mx-auto mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">Nenhuma conversa</p>
            </div>
          ) : conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelect(c)}
              className={`flex w-full flex-col gap-1 border-b border-slate-50 p-3 text-left hover:bg-slate-50 ${selected?.id === c.id ? 'bg-indigo-50' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="truncate text-sm font-medium text-slate-800">{c.customer_name}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[c.status]}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="rounded bg-slate-100 px-1.5 py-0.5">{CHANNEL_LABELS[c.channel]}</span>
                {!CHANNEL_CONFIGURED[c.channel] && !c.channel_configured && c.channel !== 'manual' && (
                  <span className="text-amber-500">não config.</span>
                )}
              </div>
              <p className="truncate text-xs text-slate-400">{(c.messages || []).slice(-1)[0]?.text || c.subject || 'Sem mensagens'}</p>
            </button>
          ))}
        </div>

        {/* Chat panel */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center">
              <div className="text-center">
                <Headset className="mx-auto mb-3 h-12 w-12 text-slate-200" />
                <p className="text-sm font-medium text-slate-600">Selecione uma conversa</p>
                <p className="mt-1 text-xs text-slate-400">Escolha uma conversa à esquerda para começar a atender.</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{selected.customer_name}</p>
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>{CHANNEL_LABELS[selected.channel]}</span>
                    {selected.customer_phone && <span>· {selected.customer_phone}</span>}
                    <span>·</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_STYLE[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  {selected.ai_enabled && (
                    <Button size="sm" variant="outline" onClick={aiRespond} disabled={aiThinking}>
                      <Sparkles className="mr-1 h-3.5 w-3.5" /> {aiThinking ? 'Pensando...' : 'IA responder'}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={createOpportunity}><UserPlus className="mr-1 h-3.5 w-3.5" /> Oportunidade</Button>
                  <Button size="sm" variant="outline" onClick={transferToHuman} disabled={selected.status === 'waiting_human'}>Transferir</Button>
                  <Button size="sm" variant="outline" onClick={finishConversation} disabled={selected.status === 'finished'}>Finalizar</Button>
                </div>
              </div>

              {/* Messages */}
              <div ref={chatRef} className="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-5">
                {(selected.messages || []).map((m, idx) => (
                  <div key={idx} className={`flex gap-2 ${m.sender === 'customer' ? 'justify-start' : 'justify-end'}`}>
                    {m.sender === 'customer' && <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-300 text-xs text-white"><User className="h-3.5 w-3.5" /></div>}
                    <div className={`max-w-[70%] rounded-2xl px-3.5 py-2 text-sm ${
                      m.sender === 'customer' ? 'bg-white text-slate-700' :
                      m.sender === 'ai' ? 'bg-violet-100 text-violet-800' :
                      'bg-indigo-600 text-white'
                    }`}>
                      {m.sender === 'ai' && <div className="mb-0.5 flex items-center gap-1 text-[10px] font-medium text-violet-500"><Bot className="h-3 w-3" /> IA</div>}
                      <p>{m.text}</p>
                      <p className={`mt-0.5 text-[10px] ${m.sender === 'agent' ? 'text-indigo-200' : 'text-slate-400'}`}>
                        {new Date(m.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {m.sender !== 'customer' && (
                      <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${m.sender === 'ai' ? 'bg-violet-200' : 'bg-indigo-200'} text-xs`}>
                        {m.sender === 'ai' ? <Bot className="h-3.5 w-3.5 text-violet-600" /> : <User className="h-3.5 w-3.5 text-indigo-600" />}
                      </div>
                    )}
                  </div>
                ))}
                {aiThinking && (
                  <div className="flex gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-200"><Bot className="h-3.5 w-3.5 text-violet-600" /></div>
                    <div className="rounded-2xl bg-violet-100 px-4 py-3 text-sm text-violet-600">IA está pensando...</div>
                  </div>
                )}
              </div>

              {/* Input */}
              <form onSubmit={sendMessage} className="flex gap-2 border-t border-slate-100 p-3">
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Digite sua mensagem..." className="flex-1" />
                <Button type="submit" disabled={!message.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </>
          )}
        </div>
      </div>

      <NewConversationDialog open={newDialog} onClose={() => setNewDialog(false)} company={company} onDone={(c) => { load(); setSelected(c); }} />
    </div>
  );
}

function NewConversationDialog({ open, onClose, company, onDone }) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [channel, setChannel] = useState('manual');
  const [firstMessage, setFirstMessage] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    const now = new Date().toISOString();
    const messages = firstMessage ? [{ sender: 'customer', text: firstMessage, timestamp: now }] : [];
    const payload = {
      company_id: company.id,
      channel,
      channel_configured: channel === 'manual',
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      subject,
      status: 'ai_assisting',
      ai_enabled: true,
      messages,
      last_message_at: now,
    };
    const conv = import.meta.env.VITE_DATA_PROVIDER === 'supabase'
      ? await conversationsService.create(company.id, payload)
      : await base44.entities.Conversation.create(payload);
    setName(''); setPhone(''); setEmail(''); setSubject(''); setFirstMessage('');
    onDone?.(conv);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Nova conversa</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome do cliente *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label className="text-xs">Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <div className="space-y-1.5"><Label className="text-xs">E-mail</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Canal</Label>
            <select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm">
              <option value="manual">Manual</option>
              <option value="whatsapp">WhatsApp (não configurado)</option>
              <option value="site">Site (não configurado)</option>
              <option value="instagram">Instagram (não configurado)</option>
              <option value="telegram">Telegram (não configurado)</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Assunto</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Motivo do contato" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Primeira mensagem</Label>
            <Textarea value={firstMessage} onChange={(e) => setFirstMessage(e.target.value)} rows={2} className="resize-none" placeholder="O que o cliente disse?" />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit">Iniciar conversa</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
