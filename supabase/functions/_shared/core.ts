import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const corsHeaders={"Access-Control-Allow-Origin":Deno.env.get('APP_ORIGIN')||"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
export function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
export function auth(req:Request){const h=req.headers.get('Authorization'); if(!h?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED'); return h.slice(7)}
export function admin(){return createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{autoRefreshToken:false,persistSession:false}})}
export function userClient(jwt:string){return createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')||Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,{global:{headers:{Authorization:`Bearer ${jwt}`}}})}
export function hashToken(token:string){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(''))}
export function safeError(){return {error:'PROVIDER_ERROR'}}
