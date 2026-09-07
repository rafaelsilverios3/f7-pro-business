export function messageContent(value:any){
 if(value?.text?.body) return {content:String(value.text.body).slice(0,4000),type:'text'};
 const map:any={image:'[Imagem recebida]',audio:'[Áudio recebido]',video:'[Vídeo recebido]',document:'[Documento recebido]',sticker:'[Figurinha recebida]',location:'[Localização recebida]',contacts:'[Contato recebido]',interactive:'[Interação recebida]',button:'[Botão recebido]'};
 const key=Object.keys(map).find((k)=>value?.[k]); return {content:key?map[key]:'[Mensagem recebida]',type:key||'unknown'};
}
export function webhookItems(payload:any){const out:any[]=[]; for(const entry of Array.isArray(payload?.entry)?payload.entry:[]) for(const change of Array.isArray(entry?.changes)?entry.changes:[]) out.push(change?.value||{}); return out;}
export function timestamp(value:any){const n=Number(value); return Number.isFinite(n)?new Date(n*1000).toISOString():new Date().toISOString();}
