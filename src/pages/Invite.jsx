import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getDataProvider } from '@/data/providerSelector';
import { Button } from '@/components/ui/button';

const roleLabels = { admin: 'Administrador', gestor: 'Gestor', financeiro: 'Financeiro', comercial: 'Comercial', vendedor: 'Vendedor', estoque: 'Estoque', atendimento: 'Atendimento' };

async function tokenHash(token) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token || ''));
  return Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export default function Invite() {
  const { token: legacyToken } = useParams();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || legacyToken || '';
  const { isAuthenticated, navigateToLogin } = useAuth();
  const [preview, setPreview] = useState(null);
  const [state, setState] = useState('loading');
  const [message, setMessage] = useState('Validando convite...');
  const hash = useMemo(() => tokenHash(token), [token]);

  useEffect(() => {
    let cancelled = false;
    if (!token) { setState('invalid'); setMessage('Convite inválido.'); return undefined; }
    hash.then((invite_token_hash) => getDataProvider().rpc('get_company_invite_preview', { invite_token_hash }))
      .then((result) => {
        if (cancelled) return;
        const data = Array.isArray(result) ? result[0] : result;
        setPreview(data || null);
        if (!data) { setState('invalid'); setMessage('Convite inválido.'); }
        else if (data.invite_status === 'expired') { setState('expired'); setMessage('Convite expirado.'); }
        else if (data.invite_status === 'accepted') { setState('accepted'); setMessage('Convite já utilizado.'); }
        else if (data.invite_status === 'cancelled') { setState('revoked'); setMessage('Convite revogado.'); }
        else { setState('ready'); setMessage('Convite válido.'); }
      })
      .catch(() => { if (!cancelled) { setState('invalid'); setMessage('Não foi possível validar o convite.'); } });
    return () => { cancelled = true; };
  }, [token, hash]);

  const accept = async () => {
    if (!isAuthenticated) { navigateToLogin(); return; }
    setState('loading'); setMessage('Aceitando convite...');
    try { await getDataProvider().rpc('accept_company_invite', { invite_token_hash: await hash }); setState('success'); setMessage('Convite aceito.'); }
    catch (error) {
      const text = String(error?.message || '');
      setState(text.includes('expirado') ? 'expired' : text.includes('revogado') ? 'revoked' : text.includes('já utilizado') ? 'accepted' : text.includes('outro e-mail') ? 'wrong_email' : 'error');
      setMessage(text.includes('outro e-mail') ? 'Este convite pertence a outro e-mail.' : text.includes('já utilizado') ? 'Convite já utilizado.' : text.includes('expirado') ? 'Convite expirado.' : text.includes('revogado') ? 'Convite revogado.' : 'Erro ao aceitar convite.');
    }
  };

  if (state === 'success') return <div className="mx-auto mt-24 max-w-md rounded-2xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Convite aceito</h1><p className="mt-2 text-sm text-slate-500">Sua conta agora tem acesso à empresa.</p><Button className="mt-5" onClick={() => window.location.assign('/f7probusiness')}>Continuar</Button></div>;
  const terminal = ['invalid', 'expired', 'accepted', 'revoked', 'wrong_email', 'error'].includes(state);
  return <div className="mx-auto mt-24 max-w-md rounded-2xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Aceitar convite</h1>{preview && <div className="mt-5 rounded-xl bg-slate-50 p-4 text-left text-sm"><p className="text-xs text-slate-500">Empresa</p><p className="font-semibold text-slate-800">{preview.company_name}</p><p className="mt-3 text-xs text-slate-500">Função</p><p className="font-semibold text-slate-800">{roleLabels[preview.invite_role] || preview.invite_role}</p><p className="mt-3 text-xs text-slate-500">E-mail convidado</p><p className="truncate text-slate-700">{preview.invited_email}</p></div>}<p className={`mt-4 text-sm ${terminal ? 'text-rose-600' : 'text-slate-500'}`}>{message}</p>{state === 'ready' && isAuthenticated && <Button className="mt-5" onClick={accept}>Aceitar convite</Button>}{state === 'ready' && !isAuthenticated && <Button variant="outline" className="mt-5 w-full" onClick={navigateToLogin}>Entrar ou criar conta</Button>}{state === 'loading' && <p className="mt-5 text-xs text-slate-400">Aguarde...</p>}</div>;
}
