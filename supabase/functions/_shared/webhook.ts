export function messageContent(value:any){
 if(value?.text?.body) return {content:String(value.text.body).slice(0,4000),type:'text'};
 const map:any={image:'[Imagem recebida]',audio:'[Áudio recebido]',video:'[Vídeo recebido]',document:'[Documento recebido]',sticker:'[Figurinha recebida]',location:'[Localização recebida]',contacts:'[Contato recebido]',interactive:'[Interação recebida]',button:'[Botão recebido]'};
 const key=Object.keys(map).find((k)=>value?.[k]); return {content:key?map[key]:'[Mensagem recebida]',type:key||'unknown'};
}
export function mediaDetails(value:any){
 const type=String(value?.type||''); const item=value?.[type]||{};
 if(!['image','video','audio','document','sticker'].includes(type)||!item?.id) return null;
 return { media_id:String(item.id).slice(0,160), mime_type:item.mime_type?String(item.mime_type).slice(0,120):null, filename:item.filename?String(item.filename).replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,160):null, caption:item.caption?String(item.caption).slice(0,4000):null, media_type:type };
}
export function webhookItems(payload:any){const out:any[]=[]; for(const entry of Array.isArray(payload?.entry)?payload.entry:[]) for(const change of Array.isArray(entry?.changes)?entry.changes:[]) out.push(change?.value||{}); return out;}
export function timestamp(value:any){const n=Number(value); return Number.isFinite(n)?new Date(n*1000).toISOString():new Date().toISOString();}
