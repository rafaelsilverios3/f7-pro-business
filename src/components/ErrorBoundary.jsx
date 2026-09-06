import React from 'react';

export default class ErrorBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('Erro não tratado na aplicação:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 px-5"><div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm"><h1 className="text-lg font-semibold text-slate-900">Ocorreu um erro ao carregar esta página.</h1><p className="mt-2 text-sm text-slate-500">Tente novamente para continuar.</p><button className="mt-5 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white" onClick={() => window.location.reload()}>Tentar novamente</button>{import.meta.env.DEV && <pre className="mt-4 max-h-32 overflow-auto text-left text-xs text-rose-600">{this.state.error.message}</pre>}</div></div>;
  }
}
