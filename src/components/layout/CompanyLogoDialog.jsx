import React, { useEffect, useState } from 'react';
import { ImagePlus, Trash2, Upload } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { uploadCompanyLogo, removeCompanyLogo, validateCompanyLogo } from '@/services/companyBrandingService';

export default function CompanyLogoDialog({ open, onClose, companyId, role, currentLogo, currentLogoPath, onSaved }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(currentLogo || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setPreview(currentLogo || ''); setFile(null); setError(''); }, [open, currentLogo]);
  useEffect(() => () => { if (preview?.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  const choose = (event) => {
    const selected = event.target.files?.[0];
    try { validateCompanyLogo(selected); setFile(selected); setPreview(URL.createObjectURL(selected)); setError(''); }
    catch (cause) { setFile(null); setError(cause.message); }
  };
  const save = async () => {
    if (!file) { setError('Selecione um arquivo antes de salvar.'); return; }
    setBusy(true); setError('');
    try { const result = await uploadCompanyLogo({ companyId, role, file }); onSaved?.(result); onClose(); }
    catch (cause) { setError(cause.message || 'Não foi possível carregar o logo.'); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await removeCompanyLogo({ companyId, role, logoPath: currentLogoPath }); onSaved?.({ url: '', path: '' }); onClose(); }
    catch (cause) { setError(cause.message || 'Não foi possível remover o logo.'); }
    finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onClose}><DialogContent className="max-w-md"><DialogHeader><DialogTitle className="flex items-center gap-2"><ImagePlus className="h-5 w-5 text-blue-300" /> Logo da empresa</DialogTitle></DialogHeader><div className="space-y-4"><div className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-slate-600 bg-slate-900/40 p-4">{preview ? <img src={preview} alt="Prévia do logo da empresa" className="max-h-32 max-w-full object-contain" /> : <div className="text-center text-slate-400"><ImagePlus className="mx-auto h-8 w-8" /><p className="mt-2 text-xs">Nenhum logo selecionado</p></div>}</div><label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-slate-600 bg-slate-900/50 px-4 py-3 text-sm font-medium text-slate-200 transition hover:border-blue-400 hover:bg-slate-800"><Upload className="h-4 w-4" /> Selecionar imagem<input type="file" className="hidden" accept="image/png,image/jpeg,image/webp" onChange={choose} /></label><p className="text-[11px] text-slate-500">PNG, JPG ou WEBP · máximo 2 MB · recomendado 200×200 px ou maior.</p>{error && <p className="text-xs text-rose-300">{error}</p>}</div><DialogFooter className="border-t border-slate-700/70 pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>{currentLogo && <Button type="button" variant="destructive" onClick={remove} disabled={busy}><Trash2 className="mr-1.5 h-4 w-4" /> Remover</Button>}<Button type="button" onClick={save} disabled={busy}>{busy ? 'Salvando...' : 'Salvar logo'}</Button></DialogFooter></DialogContent></Dialog>;
}
