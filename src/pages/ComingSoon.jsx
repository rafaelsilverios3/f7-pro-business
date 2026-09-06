// F7 PRO BUSINESS — Em breve
import React from 'react';
import PageHeader from '@/components/layout/PageHeader';

export default function ComingSoon({ title, description }) {
  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <PageHeader title={title || 'Em breve'} subtitle={description || 'Este módulo está em desenvolvimento.'} />
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white py-20 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100">
          <span className="text-2xl">🚧</span>
        </div>
        <h3 className="mt-5 text-base font-semibold text-slate-800">Módulo em construção</h3>
        <p className="mt-1 max-w-sm text-sm text-slate-500">
          Esta funcionalidade fará parte do F7 PRO BUSINESS em breve. Continue usando os módulos já disponíveis no menu lateral.
        </p>
      </div>
    </div>
  );
}