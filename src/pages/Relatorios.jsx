import React, { useState, useEffect, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Download, FileText, BarChart3 } from 'lucide-react';
import { reportsService } from '@/services/reportsService';
import { fmtMoney, fmtDate, fmtNum, periodKey } from '@/lib/business';
import PageHeader from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';

const REPORTS = [
  { id: 'sales', label: 'Vendas e Faturamento', icon: BarChart3 },
  { id: 'profit', label: 'Lucro e Margem', icon: BarChart3 },
  { id: 'customers', label: 'Clientes', icon: BarChart3 },
  { id: 'abc', label: 'Curva ABC', icon: BarChart3 },
  { id: 'products', label: 'Produtos', icon: BarChart3 },
  { id: 'stock', label: 'Estoque e Movimentações', icon: BarChart3 },
  { id: 'purchases', label: 'Compras e Fornecedores', icon: BarChart3 },
  { id: 'financial', label: 'Financeiro', icon: BarChart3 },
  { id: 'sellers', label: 'Vendedores', icon: BarChart3 },
];

export default function Relatorios() {
  const { company } = useOutletContext();
  const [report, setReport] = useState('sales');
  const [period, setPeriod] = useState('month');
  const [data, setData] = useState(null);

  const load = async () => {
    if (!company) return;
    setData(await reportsService.load(company.id));
  };
  useEffect(() => { load(); }, [company]);

  const exportCSV = (rows, headers, filename) => {
    const csv = [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${filename}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = (title, content) => {
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>${title}</title><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#f5f5f5}h1{font-size:18px}</style></head><body><h1>${title}</h1>${content}</body></html>`);
    win.document.close();
    win.print();
  };

  const reportData = useMemo(() => {
    if (!data) return null;
    const validSales = data.sales.filter((s) => s.status !== 'cancelled');
    const cur = validSales.filter((s) => periodKey(s.sale_date, period));

    switch (report) {
      case 'sales': {
        const rows = cur.map((s) => [fmtDate(s.sale_date), s.customer_name, s.seller || '', s.payment_method || '', s.total || 0, s.status]);
        return { headers: ['Data', 'Cliente', 'Vendedor', 'Pagamento', 'Total', 'Status'], rows, total: cur.reduce((a, s) => a + (s.total || 0), 0) };
      }
      case 'profit': {
        const rows = cur.map((s) => [fmtDate(s.sale_date), s.customer_name, s.total || 0, s.cost_total || 0, s.profit || 0, s.total > 0 ? ((s.profit / s.total) * 100).toFixed(1) + '%' : '0%']);
        return { headers: ['Data', 'Cliente', 'Total', 'Custo', 'Lucro', 'Margem'], rows, total: cur.reduce((a, s) => a + (s.profit || 0), 0) };
      }
      case 'customers': {
        const rows = data.customers.map((c) => [c.name, c.document || '', c.email || '', c.phone || '', c.status, c.classification?.toUpperCase(), c.total_purchased || 0, c.sale_count || 0]);
        return { headers: ['Nome', 'Documento', 'E-mail', 'Telefone', 'Status', 'Classe', 'Total Comprado', 'Compras'], rows };
      }
      case 'abc': {
        const prodMap = {};
        validSales.forEach((s) => (s.items || []).forEach((i) => {
          prodMap[i.name] = (prodMap[i.name] || 0) + (i.total || 0);
        }));
        const sorted = Object.entries(prodMap).sort((a, b) => b[1] - a[1]);
        const total = sorted.reduce((s, [, v]) => s + v, 0);
        let cum = 0;
        const rows = sorted.map(([name, val]) => {
          cum += val;
          const pct = (val / total) * 100;
          const cumPct = (cum / total) * 100;
          const cls = cumPct <= 80 ? 'A' : cumPct <= 95 ? 'B' : 'C';
          return [name, val, pct.toFixed(1) + '%', cumPct.toFixed(1) + '%', cls];
        });
        return { headers: ['Produto', 'Faturamento', '%', '% Acumulado', 'Classe'], rows };
      }
      case 'products': {
        const rows = data.products.map((p) => [p.sku || '', p.name, p.category || '', p.brand || '', p.cost_price || 0, p.sale_price || 0, p.stock || 0, p.min_stock || 0, p.active ? 'Ativo' : 'Inativo']);
        return { headers: ['SKU', 'Nome', 'Categoria', 'Marca', 'Custo', 'Venda', 'Estoque', 'Mínimo', 'Status'], rows };
      }
      case 'stock': {
        const rows = data.movements.map((m) => [fmtDate(m.created_date), m.product_name, m.type, m.quantity, m.reason || '']);
        return { headers: ['Data', 'Produto', 'Tipo', 'Qtd', 'Motivo'], rows };
      }
      case 'purchases': {
        const rows = data.purchases.map((p) => [fmtDate(p.created_date), p.supplier_name, p.total || 0, p.status, fmtDate(p.expected_date), fmtDate(p.received_date)]);
        return { headers: ['Data', 'Fornecedor', 'Total', 'Status', 'Previsão', 'Recebido'], rows };
      }
      case 'financial': {
        const rows = data.fin.map((f) => [f.type === 'receivable' ? 'Receber' : 'Pagar', f.description, f.category || '', f.amount || 0, fmtDate(f.due_date), f.status]);
        return { headers: ['Tipo', 'Descrição', 'Categoria', 'Valor', 'Vencimento', 'Status'], rows };
      }
      case 'sellers': {
        const sellerMap = {};
        cur.forEach((s) => {
          const k = s.seller || 'Sem vendedor';
          if (!sellerMap[k]) sellerMap[k] = { name: k, sales: 0, total: 0, profit: 0 };
          sellerMap[k].sales++;
          sellerMap[k].total += s.total || 0;
          sellerMap[k].profit += s.profit || 0;
        });
        const rows = Object.values(sellerMap).sort((a, b) => b.total - a.total).map((s) => [s.name, s.sales, s.total, s.profit]);
        return { headers: ['Vendedor', 'Vendas', 'Faturamento', 'Lucro'], rows };
      }
      default: return null;
    }
  }, [data, report, period]);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <PageHeader
        title="Relatórios"
        subtitle="Relatórios detalhados com filtros e exportação."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            onClick={() => setReport(r.id)}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${report === r.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}
          >
            <r.icon className="h-3.5 w-3.5" /> {r.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex items-center justify-between">
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1">
          {[{ v: 'day', l: 'Hoje' }, { v: 'month', l: 'Mês' }, { v: 'year', l: 'Ano' }, { v: 'all', l: 'Tudo' }].map((p) => (
            <button key={p.v} onClick={() => setPeriod(p.v)} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${period === p.v ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>{p.l}</button>
          ))}
        </div>
        {reportData && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => exportCSV(reportData.rows, reportData.headers, `relatorio-${report}`)}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => {
              const tableHtml = `<table><thead><tr>${reportData.headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${reportData.rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
              exportPDF(`Relatório: ${REPORTS.find((r) => r.id === report)?.label}`, tableHtml);
            }}>
              <FileText className="mr-1.5 h-3.5 w-3.5" /> PDF
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {!reportData ? (
          <div className="p-12 text-center text-sm text-slate-400">Carregando...</div>
        ) : reportData.rows.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700">Sem dados para este relatório</p>
            <p className="mt-1 text-xs text-slate-400">Tente outro período ou verifique se há registros.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs text-slate-500">
                  {reportData.headers.map((h, i) => <th key={i} className={`px-4 py-3 font-medium ${i >= 3 && i !== reportData.headers.length - 1 ? 'text-right' : ''}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {reportData.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-50 hover:bg-slate-50/50">
                    {r.map((c, j) => <td key={j} className={`px-4 py-3 ${j >= 3 && j !== r.length - 1 ? 'text-right' : ''} ${j === 0 ? 'font-medium text-slate-800' : 'text-slate-600'}`}>{typeof c === 'number' ? (c > 100 ? fmtMoney(c) : fmtNum(c)) : c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
