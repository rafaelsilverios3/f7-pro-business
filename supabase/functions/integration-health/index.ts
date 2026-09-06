import { corsHeaders,json } from '../_shared/core.ts';
Deno.serve(async(req)=>{if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders}); return json({whatsapp_enabled:Deno.env.get('WHATSAPP_ENABLED')==='true',ai_enabled:Deno.env.get('AI_ENABLED')==='true',service_role_configured:Boolean(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))});});
