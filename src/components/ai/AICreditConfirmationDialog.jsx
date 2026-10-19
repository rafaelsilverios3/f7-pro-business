import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const integer = (value) => Number(value || 0).toLocaleString('pt-BR');

export default function AICreditConfirmationDialog({ quote, busy = false, onCancel, onConfirm }) {
  return <Dialog open={Boolean(quote)} onOpenChange={(open) => { if (!open && !busy) onCancel?.(); }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Confirmar análise com IA</DialogTitle>
        <DialogDescription>A estimativa é calculada e validada pelo servidor para esta solicitação, empresa e modelo.</DialogDescription>
      </DialogHeader>
      {quote && <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
        <p><span className="text-slate-500">Custo máximo autorizado:</span> <strong>{integer(quote.max_credits)} créditos</strong></p>
        <p><span className="text-slate-500">Saldo atual:</span> <strong>{integer(quote.balance)} créditos</strong></p>
        <p><span className="text-slate-500">Saldo mínimo após a análise:</span> <strong>{integer(quote.minimum_balance_after)} créditos</strong></p>
        {quote.model && <p className="text-xs text-slate-500">Modelo: {quote.model}</p>}
        <p className="text-xs text-slate-500">A operação será interrompida se o consumo real exceder este teto. A reserva não utilizada retorna ao saldo.</p>
      </div>}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar</Button>
        <Button type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Confirmando…' : 'Confirmar análise'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
