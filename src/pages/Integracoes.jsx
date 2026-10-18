import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Bot, CheckCircle2, Database, ExternalLink, MessageSquare, RefreshCw, ShieldCheck, Wifi, XCircle, PlugZap, Unplug } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { useCompanyMembership } from '@/hooks/useCompanyMembership';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { checkIntegrationHealth, connectWhatsApp, disconnectWhatsApp, listIntegrationLogs, listIntegrations, safeInternalDiagnostic, safeMetaDiagnostic, testWhatsAppConnection } from '@/services/integrationsService';
import { getAssistantSettings } from '@/services/assistantSettingsService';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { getWhatsAppIntegrationState } from '@/lib/whatsappIntegrationState';

const statusLabel = { connected: 'Conectado', disconnected: 'Desconectado', pending: 'Configuração pendente', error: 'Erro', disabled: 'Desabilitado', not_configured: 'Configuração pendente' };
const statusTone = { connected: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/30', error: 'text-rose-300 bg-rose-400/10 border-rose-400/30', disabled: 'text-slate-400 bg-slate-400/10 border-slate-400/20', disconnected: 'text-slate-300 bg-slate-400/10 border-slate-400/20', pending: 'text-amber-300 bg-amber-400/10 border-amber-400/30', not_configured: 'text-amber-300 bg-amber-400/10 border-amber-400/30' };

function StatusBadge({ status }) {
  const key = status || 'not_configured';
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${statusTone[key] || statusTone.not_configured}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{statusLabel[key] || key}</span>;
}

function IntegrationCard({ icon: Icon, title, description, status, children, actions }) {
  return <section className="rounded-2xl border border-slate-700/60 bg-gradient-to-br from-[#10213a] to-[#0b1626] p-5 shadow-[0_12px_32px_rgba(0,0,0,.14)] sm:p-6"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div className="flex gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-blue-400/20 bg-blue-500/10 text-blue-300"><Icon className="h-5 w-5" /></span><div><h2 className="text-base font-semibold text-white">{title}</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">{description}</p></div></div><StatusBadge status={status} /></div>{children}{actions && <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-700/60 pt-4">{actions}</div>}</section>;
}

function Indicator({ label, status, icon: Icon }) { return <div className="rounded-xl border border-slate-700/60 bg-[#0b1728] p-3"><div className="flex items-center gap-2 text-xs font-medium text-slate-300"><Icon className="h-3.5 w-3.5 text-slate-500" />{label}</div><p className="mt-2 text-[10px] text-slate-400">{status}</p></div>; }

function MetaDiagnosticPanel({ diagnostic }) {
  if (!diagnostic) return null;
  const value = (item) => item == null || item === '' ? 'não informado' : item;
  return <div className="mb-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-xs text-amber-100"><p className="font-semibold">Diagnóstico seguro da Meta</p><p className="mt-1">Meta recusou a validação do número.</p><dl className="mt-3 grid gap-1 text-[11px] sm:grid-cols-2"><div><dt className="inline text-amber-200/70">HTTP: </dt><dd className="inline">{value(diagnostic.httpStatus)}</dd></div><div><dt className="inline text-amber-200/70">Código Meta: </dt><dd className="inline">{value(diagnostic.code)}</dd></div><div><dt className="inline text-amber-200/70">Subcódigo: </dt><dd className="inline">{value(diagnostic.subcode)}</dd></div><div><dt className="inline text-amber-200/70">Tipo: </dt><dd className="inline">{value(diagnostic.type)}</dd></div><div className="sm:col-span-2"><dt className="inline text-amber-200/70">Graph API: </dt><dd className="inline">{value(diagnostic.graphVersion)}</dd></div></dl>{diagnostic.message && <p className="mt-3 border-t border-amber-300/20 pt-2 text-[11px] text-amber-100/90"><span className="text-amber-200/70">Mensagem: </span>{diagnostic.message}</p>}</div>;
}

function ProviderHealthDiagnostic({ diagnostic }) {
  if (!diagnostic) return null;
  const value = (item) => item == null || item === '' ? 'não informado' : item;
  return <div className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[11px] text-slate-300"><p className="font-medium text-rose-200">Diagnóstico seguro da Meta</p><div className="mt-1 grid gap-1 sm:grid-cols-2"><span>HTTP provider: {value(diagnostic.http_status)}</span><span>Código Meta: {value(diagnostic.meta_code)}</span><span>Tipo Meta: {value(diagnostic.meta_type)}</span><span>Graph API: {value(diagnostic.graph_version)}</span></div></div>;
}

function InternalDiagnosticPanel({ diagnostic }) {
  if (!diagnostic) return null;
  return <div className="mb-5 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-xs text-rose-100"><p className="font-semibold">Falha interna na integração</p><p className="mt-2">Etapa: <span className="font-mono">{diagnostic.stage || 'não informado'}</span></p><p className="mt-1">Código interno: <span className="font-mono">{diagnostic.internalCode || 'não informado'}</span></p><p className="mt-1">HTTP: {diagnostic.httpStatus || 'não informado'}</p></div>;
}

export default function Integracoes() {
  const { company } = useOutletContext();
  const [integrations, setIntegrations] = useState([]);
  const [logs, setLogs] = useState([]);
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [metaDiagnostic, setMetaDiagnostic] = useState(null);
  const [internalDiagnostic, setInternalDiagnostic] = useState(null);
  const [action, setAction] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [aiFeatureAvailable, setAiFeatureAvailable] = useState(null);
  const [assistantMode, setAssistantMode] = useState('manual');
  const { role: memberRole, active: membershipActive, loading: membershipLoading } = useCompanyMembership(company?.id);
  const canManage = !membershipLoading && membershipActive && ['admin', 'gestor'].includes(memberRole);

  const load = useCallback(async (refresh = false) => { if (!company?.id) return; refresh ? setRefreshing(true) : setLoading(true); setError(''); try { const [nextIntegrations, nextLogs] = await Promise.all([listIntegrations(company.id), listIntegrationLogs(company.id)]); setIntegrations(nextIntegrations); setLogs(nextLogs); try { setHealth(await checkIntegrationHealth(company.id)); } catch { setHealth(null); } } catch (cause) { setError(cause.message || 'Não foi possível carregar o status das integrações.'); } finally { setLoading(false); setRefreshing(false); } }, [company?.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!company?.id || import.meta.env.VITE_DATA_PROVIDER !== 'supabase') return undefined;
    let cancelled = false;
    Promise.all([
      getAssistantSettings(company.id),
      getSupabaseClient().rpc('company_has_feature', { target_company: company.id, feature: 'ai' }),
    ]).then(([settings, feature]) => {
      if (cancelled) return;
      setAssistantMode(settings?.mode || 'manual');
      setAiFeatureAvailable(feature?.error ? false : feature?.data === true);
    }).catch(() => { if (!cancelled) { setAssistantMode('manual'); setAiFeatureAvailable(false); } });
    return () => { cancelled = true; };
  }, [company?.id]);

  const whatsapp = integrations.find((item) => item.provider === 'whatsapp');
  const ai = integrations.find((item) => item.provider === 'ai');
  const aiAssistedAvailable = aiFeatureAvailable === true && assistantMode === 'assisted';
  const disabledAction = <Button variant="outline" size="sm" disabled title="Disponível após ativação da integração"><ExternalLink className="h-3.5 w-3.5" /> Disponível após ativação</Button>;
  const counts = useMemo(() => { const values = [whatsapp, ai]; return { active: values.filter((item) => item?.status === 'connected').length, pending: values.filter((item) => !item || ['pending', 'not_configured'].includes(item.status)).length, error: values.filter((item) => item?.status === 'error').length }; }, [whatsapp, ai]);
  useEffect(() => { if (whatsapp?.external_phone_id) setPhoneNumberId(whatsapp.external_phone_id); }, [whatsapp?.external_phone_id]);
  const runAction = async (name, fn) => { setAction(name); setError(''); setMetaDiagnostic(null); setInternalDiagnostic(null); try { await fn(); await load(true); } catch (cause) { const diagnostic = safeMetaDiagnostic(cause); const internal = safeInternalDiagnostic(cause); setMetaDiagnostic(diagnostic); setInternalDiagnostic(internal); setError(cause.message || 'Não foi possível concluir a ação.'); } finally { setAction(''); } };
  const whatsappHealth = health?.integrations?.find((item) => item.company_id === company?.id)?.whatsapp;
  const whatsappState = getWhatsAppIntegrationState(whatsappHealth, whatsapp);
  const whatsappEnabled = whatsappState.providerEnabled;
  const whatsappConnected = whatsappState.connected;
  const whatsappActions = membershipLoading ? <span className="text-xs text-slate-400">Verificando permissões…</span> : !canManage ? null : whatsappConnected ? <><Button variant="outline" size="sm" onClick={() => runAction('test', () => testWhatsAppConnection(company.id))} disabled={Boolean(action)}><RefreshCw className={`mr-2 h-3.5 w-3.5 ${action === 'test' ? 'animate-spin' : ''}`} /> Testar conexão</Button><Button variant="outline" size="sm" onClick={() => runAction('disconnect', () => disconnectWhatsApp(company.id))} disabled={Boolean(action)}><Unplug className="mr-2 h-3.5 w-3.5" /> Desconectar</Button></> : <><div className="flex min-w-[230px] items-center gap-2"><input aria-label="ID do número WhatsApp" value={phoneNumberId} onChange={(event) => setPhoneNumberId(event.target.value.replace(/\D/g, ''))} placeholder="Phone Number ID" className="h-9 rounded-lg border border-slate-600 bg-slate-900 px-3 text-xs text-white outline-none focus:border-blue-400" /><Button size="sm" onClick={() => runAction('connect', () => connectWhatsApp(company.id, phoneNumberId))} disabled={Boolean(action) || !phoneNumberId}><PlugZap className="mr-2 h-3.5 w-3.5" /> {action === 'connect' ? 'Validando…' : whatsapp?.status === 'error' ? 'Tentar novamente' : 'Conectar WhatsApp'}</Button></div><Button variant="outline" size="sm" onClick={() => runAction('test', () => testWhatsAppConnection(company.id))} disabled={Boolean(action)}><RefreshCw className="mr-2 h-3.5 w-3.5" /> Testar conexão</Button></>;

  if (loading) return <div className="flex min-h-96 items-center justify-center"><RefreshCw className="h-5 w-5 animate-spin text-blue-400" /></div>;
  return <div className="mx-auto w-full max-w-[1500px] px-5 py-7 xl:px-8"><PageHeader title="Central de Integrações" subtitle="Conecte serviços externos ao F7 PRO BUSINESS e acompanhe o status de cada integração." action={<Button variant="outline" onClick={() => load(true)} disabled={refreshing}><RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar status</Button>} />
    {error && <div className="mb-5 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-200">{error}</div>}
    <InternalDiagnosticPanel diagnostic={internalDiagnostic} />
    <MetaDiagnosticPanel diagnostic={metaDiagnostic} />
    <div className="mb-6 grid grid-cols-3 gap-3"><div className="rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-4"><p className="text-[10px] uppercase tracking-wider text-slate-400">Integrações ativas</p><p className="mt-1 text-2xl font-bold text-emerald-300">{counts.active}</p></div><div className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4"><p className="text-[10px] uppercase tracking-wider text-slate-400">Pendentes</p><p className="mt-1 text-2xl font-bold text-amber-300">{counts.pending}</p></div><div className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4"><p className="text-[10px] uppercase tracking-wider text-slate-400">Com erro</p><p className="mt-1 text-2xl font-bold text-rose-300">{counts.error}</p></div></div>
    <div className="grid gap-5 xl:grid-cols-2"><IntegrationCard icon={MessageSquare} title="WhatsApp Cloud API" description="Conecte seu número oficial para enviar e receber mensagens diretamente pelo F7 PRO BUSINESS." status={whatsappState.status} actions={whatsappConnected || whatsappEnabled ? whatsappActions : <Button variant="outline" size="sm" disabled><ExternalLink className="h-3.5 w-3.5" /> {whatsappHealth ? 'Disponível após ativação' : 'Verificando configuração do servidor'}</Button>}><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5"><Indicator label="Webhook" status={whatsappHealth?.webhook === 'ok' ? 'Funcionando' : whatsappHealth?.webhook === 'disabled' ? 'Desabilitado neste ambiente' : 'Pendente'} icon={Wifi} /><Indicator label="Cloud API" status={whatsappHealth?.provider === 'ok' ? 'Confirmada' : whatsappHealth?.provider === 'error' ? 'Erro' : whatsappHealth?.provider === 'disabled' ? 'Desabilitada neste ambiente' : 'Não testada'} icon={Activity} /><Indicator label="Número" status={whatsappHealth?.phone === 'configured' || Boolean(whatsapp?.external_phone_id) ? 'Configurado' : 'Não configurado'} icon={MessageSquare} /><Indicator label="Envio" status={whatsappHealth?.send === 'ready' ? 'Confirmado' : whatsappHealth?.send === 'disabled' ? 'Desabilitado neste ambiente' : 'Não testado'} icon={CheckCircle2} /><Indicator label="Recebimento" status={whatsappHealth?.receive === 'ready' ? 'Funcionando' : whatsappHealth?.receive === 'disabled' ? 'Desabilitado neste ambiente' : 'Não testado'} icon={CheckCircle2} /></div>{whatsappHealth?.provider === 'error' && <ProviderHealthDiagnostic diagnostic={whatsappHealth.provider_diagnostic} />}<p className="mt-4 rounded-lg border border-slate-700/60 bg-slate-900/30 px-3 py-2 text-xs text-slate-300">O envio continua sob controle do servidor e permanece desligado até habilitação explícita. Nenhum token é solicitado ou exibido nesta tela.</p></IntegrationCard>
      <IntegrationCard icon={Bot} title="F7 Intelligence / Assistente IA" description="Use inteligência artificial para auxiliar atendimento, análises e automações." status={aiFeatureAvailable === null ? 'pending' : aiAssistedAvailable ? 'connected' : 'disabled'} actions={aiAssistedAvailable ? <span className="text-xs text-emerald-300">Disponível no Smart Atendimento · revisão humana obrigatória</span> : <>{disabledAction}</>}><div className="mt-5 grid grid-cols-2 gap-3"><Indicator label="Assistente" status={aiFeatureAvailable === null ? 'Verificando disponibilidade' : aiFeatureAvailable ? (assistantMode === 'assisted' ? 'Modo assistido' : 'Modo manual') : 'Indisponível para esta empresa'} icon={Bot} /><Indicator label="Respostas automáticas" status="Desativadas" icon={Activity} /><Indicator label="Handoff humano" status="Sempre exigido" icon={ShieldCheck} /><Indicator label="Contexto" status="Protegido" icon={Database} /></div><p className="mt-4 rounded-lg border border-violet-400/20 bg-violet-400/5 px-3 py-2 text-xs text-violet-200">{aiFeatureAvailable === null ? 'Consultando disponibilidade segura da empresa.' : aiFeatureAvailable && assistantMode === 'assisted' ? 'IA assistida disponível; a geração continua validada pelo backend.' : aiFeatureAvailable ? 'Ative o modo Assistido nas Configurações de Atendimento.' : 'IA não disponível para esta empresa no entitlement atual.'}</p></IntegrationCard>
      <IntegrationCard icon={Database} title="Supabase" description="Backend, autenticação, banco de dados e funções server-side do F7 PRO BUSINESS." status={health ? 'connected' : 'not_configured'}><div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4"><Indicator label="Backend" status="Conectado" icon={Database} /><Indicator label="Autenticação" status="Verificada pela sessão" icon={ShieldCheck} /><Indicator label="Banco de dados" status="Operacional para esta tela" icon={Activity} /><Indicator label="Funções server-side" status={health ? 'Respondendo' : 'Não verificado'} icon={Wifi} /></div></IntegrationCard>
    </div>
    <section className="mt-5 rounded-2xl border border-slate-700/60 bg-[#0e1a2b] p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-300" /><h2 className="text-base font-semibold text-white">Atividade recente</h2></div>{logs.length ? <div className="mt-4 divide-y divide-slate-700/50">{logs.map((log) => <div key={log.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs"><div><p className="font-medium text-slate-200">{log.event}</p><p className="mt-1 text-[10px] text-slate-500">{log.provider} · {log.created_at ? new Date(log.created_at).toLocaleString('pt-BR') : 'Data indisponível'}</p></div><StatusBadge status={log.status === 'success' ? 'connected' : log.status === 'error' ? 'error' : 'pending'} /></div>)}</div> : <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-slate-700 p-5 text-xs text-slate-400"><XCircle className="h-4 w-4" /> Nenhuma atividade registrada.</div>}</section>
    {membershipLoading && <p className="mt-4 text-[11px] text-slate-400">Verificando permissões…</p>}
    {!membershipLoading && !canManage && <p className="mt-4 text-[11px] text-slate-500">Somente administradores e gestores podem gerenciar integrações.</p>}
  </div>;
}
