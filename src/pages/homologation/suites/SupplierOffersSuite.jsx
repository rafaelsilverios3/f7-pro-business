import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '@/data/providers/supabaseProvider';
import { isExactHomologationBuild, isUuid, validateOperationSession } from '../runnerConfig';
import {
  prepareSupplierOfferFixture,
  runSellerSupplierOfferChecks,
  runSupplierOffersReadChecks,
  verifySupplierOfferFixture,
} from './supplierOffersChecks';

function confirmAction(message) {
  return typeof window !== 'undefined' && window.confirm(message);
}

export default function SupplierOffersSuite({ isAuthenticated, onResults }) {
  const [busy, setBusy] = useState(false);
  const [fixture, setFixture] = useState(null);
  const [targetId, setTargetId] = useState('');
  const [targetMarker, setTargetMarker] = useState('');
  const [identity, setIdentity] = useState(null);
  const exactProject = isExactHomologationBuild();

  useEffect(() => {
    let cancelled = false;
    setIdentity(null);
    if (!isAuthenticated || !exactProject) return () => { cancelled = true; };
    try {
      validateOperationSession(getSupabaseClient(), ['admin', 'vendedor'])
        .then((guard) => {
          if (!cancelled && !guard.error) setIdentity({ label: guard.identity.label, company: guard.identity.company, role: guard.identity.role });
        })
        .catch(() => {});
    } catch {
      // A missing local client configuration is shown as an unavailable session; never fall back to another project.
    }
    return () => { cancelled = true; };
  }, [isAuthenticated, exactProject]);

  const run = async (operation) => {
    if (busy || !exactProject) return;
    setBusy(true);
    try {
      const entries = await operation(getSupabaseClient());
      onResults(entries);
    } catch {
      onResults([{ identity: identity?.label || 'Sessão atual', company: identity?.company || '—', resource: 'supplier_offers', operation: 'suite execution', expected: 'resultado sanitizado', state: 'BLOCKED', status: null, detail: 'falha de rede ou cliente; detalhes brutos omitidos' }]);
    } finally {
      setBusy(false);
    }
  };

  const createFixture = () => {
    if (!confirmAction('Criar uma oferta fictícia em rascunho na Empresa Homolog A via RPC oficial? O registro de teste e sua trilha de auditoria permanecerão no banco; nenhum estoque, compra ou financeiro deve mudar.')) return;
    run(async (supabase) => {
      const outcome = await prepareSupplierOfferFixture(supabase);
      if (outcome.fixture) {
        setFixture(outcome.fixture);
        setTargetId(outcome.fixture.id);
        setTargetMarker(outcome.fixture.marker);
      }
      return outcome.rows;
    });
  };

  const testSellerWrites = () => {
    if (!isUuid(targetId) || !/^F7_HOMOLOG_OFFER_A_[A-F0-9]{32}$/.test(targetMarker)) return;
    if (!confirmAction('Executar pelo JWT real do Vendedor A: INSERT fictício e tentativas PATCH/DELETE somente contra a fixture descartável informada, seguidos das três RPCs de oferta? Se alguma operação for aceita, o executor para imediatamente e preserva o resultado; não haverá limpeza automática.')) return;
    run((supabase) => runSellerSupplierOfferChecks(supabase, { fixtureId: targetId.trim(), marker: targetMarker.trim() }));
  };

  return <section className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="font-semibold text-cyan-100">Suite Supplier Offers</h3><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-300">As leituras identificam automaticamente Admin A, Admin B ou Vendedor A pelo Supabase Auth e pelo vínculo ativo. Escritas não executam ao abrir a rota e pedem confirmação separada.</p></div>
      <button type="button" disabled={busy || !exactProject || !isAuthenticated} onClick={() => run(runSupplierOffersReadChecks)} className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-semibold disabled:opacity-50">{busy ? 'Executando…' : 'Executar leitura REST Supplier Offers'}</button>
    </div>

    {identity?.label === 'Admin A' && <div className="mt-4 rounded-lg border border-amber-700/70 bg-amber-950/30 p-3">
      <p className="text-xs text-amber-100">Para testar PATCH/DELETE sem tocar nas duas ofertas homologadas, crie uma fixture separada em rascunho. A migration não oferece exclusão direta; o registro de teste ficará no ambiente e terá marcador rastreável.</p>
      <button type="button" disabled={busy || !exactProject} onClick={createFixture} className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold disabled:opacity-50">Preparar fixture isolada para os testes do vendedor</button>
    </div>}

    {fixture && <div className="mt-3 rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-xs text-emerald-100">
      <p>Fixture fictícia persistida via RPC · Empresa A · status draft · id <code className="break-all">{fixture.id}</code></p>
      <p className="mt-1">Marcador <code className="break-all">{fixture.marker}</code>. Compartilhe somente esses identificadores de teste com a sessão do vendedor.</p>
      <button type="button" disabled={busy || !exactProject} onClick={() => run((supabase) => verifySupplierOfferFixture(supabase, fixture))} className="mt-3 rounded-lg bg-emerald-800 px-3 py-2 font-semibold disabled:opacity-50">Confirmar fixture e estoque após os testes</button>
    </div>}

    {identity?.label === 'Vendedor A' && <div className="mt-4 grid gap-3 rounded-lg border border-slate-700 p-3">
      <label className="text-xs text-slate-200">Fixture descartável criada por Admin A
        <input value={targetId} onChange={(event) => setTargetId(event.target.value)} placeholder="UUID da fixture" className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs" />
      </label>
      <label className="text-xs text-slate-200">Marcador exibido pela sessão Admin A
        <input value={targetMarker} onChange={(event) => setTargetMarker(event.target.value)} placeholder="F7_HOMOLOG_OFFER_A_..." className="mt-1 w-full rounded border border-slate-600 bg-slate-900 px-3 py-2 font-mono text-xs" />
      </label>
      <button type="button" disabled={busy || !exactProject || !isUuid(targetId) || !/^F7_HOMOLOG_OFFER_A_[A-F0-9]{32}$/.test(targetMarker)} onClick={testSellerWrites} className="justify-self-start rounded-lg bg-rose-800 px-3 py-2 text-xs font-semibold disabled:opacity-50">Testar INSERT, PATCH, DELETE e as três RPCs</button>
      <p className="text-[11px] text-slate-400">Qualquer resposta de sucesso inesperada interrompe a sequência. A verificação posterior deve ser executada por Admin A na sessão proprietária.</p>
    </div>}

    <div className="mt-4 border-t border-slate-800 pt-3">
      <p className="text-xs text-slate-300">Falha real e reversível de carregamento: abre Compras &gt; Ofertas e faz uma consulta somente de leitura a uma coluna inexistente, que deve retornar HTTP 400 e aparecer no estado de erro da própria aba. O parâmetro de teste é removido antes do retry.</p>
      <button type="button" disabled={busy || !exactProject || !isAuthenticated} onClick={() => window.location.assign('/compras?__homologation_offers_error=1')} className="mt-2 rounded-lg border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 disabled:opacity-50">Validar erro real de carregamento da aba Ofertas</button>
    </div>
  </section>;
}
