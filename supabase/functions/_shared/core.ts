import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
export const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type"};
export function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}})}
export function auth(req:Request){const h=req.headers.get('Authorization'); if(!h?.startsWith('Bearer ')) throw new Error('AUTH_REQUIRED'); return h.slice(7)}
export function admin(){const url=Deno.env.get('SUPABASE_URL')!, key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!; return createClient(url,key,{auth:{autoRefreshToken:false,persistSession:false}})}
export function hashToken(token:string){return crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)).then(b=>Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,'0')).join(''))}
