import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { getDataProvider } from '@/data/providerSelector';
import { Button } from '@/components/ui/button';
export default function Invite() {
 const { token } = useParams(); const { isAuthenticated, navigateToLogin } = useAuth(); const [state,setState]=useState('idle');
 const accept=async()=>{ if(!isAuthenticated) return navigateToLogin(); setState('loading'); try { const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token||'')); const tokenHash=Array.from(new Uint8Array(hash)).map((b)=>b.toString(16).padStart(2,'0')).join(''); await getDataProvider().rpc('accept_company_invite',{invite_token_hash:tokenHash}); setState('success'); } catch { setState('error'); } };
 if(state==='success') return <div className="mx-auto mt-24 max-w-md rounded-2xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Convite aceito</h1><p className="mt-2 text-sm text-slate-500">Sua conta agora tem acesso à empresa.</p><Button className="mt-5" onClick={()=>window.location.assign('/dashboard')}>Continuar</Button></div>;
 return <div className="mx-auto mt-24 max-w-md rounded-2xl border bg-white p-8 text-center"><h1 className="text-xl font-semibold">Convite para empresa</h1><p className="mt-2 text-sm text-slate-500">Aceite o convite para entrar na empresa.</p>{state==='error'&&<p className="mt-3 text-sm text-rose-600">Convite inválido, expirado ou já utilizado.</p>}<Button className="mt-5" onClick={accept} disabled={state==='loading'}>{isAuthenticated?'Aceitar convite':'Entrar para aceitar'}</Button></div>;
}
