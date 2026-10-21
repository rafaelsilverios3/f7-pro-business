import { jsPDF } from 'jspdf';

const datePart = (value) => {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
};

export function quoteReference(quote) {
  const year = datePart(quote?.created_at).slice(0, 4);
  return `ORC-${year}-${String(quote?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'NOVO'}`;
}

export function saleReference(sale) {
  return `VEN-${datePart(sale?.sale_date || sale?.created_at).slice(0, 4)}-${String(sale?.id || '').replace(/-/g, '').slice(0, 8).toUpperCase() || 'NOVA'}`;
}

function drawDocument({ title, reference, company, customer, date, items = [], subtotal = 0, discount = 0, addition = 0, total = 0, nonFiscal = false }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = pdf.internal.pageSize.getWidth();
  const formatMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: ['BRL', 'USD', 'EUR'].includes(company?.currency) ? company.currency : 'BRL' }).format(Number(value || 0));
  let y = 18;
  pdf.setFillColor(17, 71, 148);
  pdf.roundedRect(14, 12, width - 28, 25, 3, 3, 'F');
  pdf.setTextColor(255, 255, 255);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(16);
  pdf.text('F7 PRO BUSINESS', 20, 22);
  pdf.setFontSize(11);
  pdf.text(title, width - 20, 22, { align: 'right' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.text(reference, 20, 30);
  if (nonFiscal) pdf.text('DOCUMENTO SIMULADO · NÃO FISCAL · NÃO SUBSTITUI NF-e/NFC-e', width - 20, 30, { align: 'right' });
  pdf.setTextColor(30, 41, 59);
  y = 47;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(company?.name || 'Empresa', 16, y); y += 6;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9);
  for (const line of [company?.document, company?.address, [company?.phone, company?.email].filter(Boolean).join(' · ')].filter(Boolean)) {
    pdf.text(pdf.splitTextToSize(String(line), width - 32), 16, y); y += 5;
  }
  y += 4; pdf.setDrawColor(190, 202, 219); pdf.line(16, y, width - 16, y); y += 8;
  pdf.setFont('helvetica', 'bold'); pdf.text('Cliente', 16, y); pdf.setFont('helvetica', 'normal'); pdf.text(customer?.name || 'Cliente não informado', 42, y); y += 6;
  pdf.setFont('helvetica', 'bold'); pdf.text('Data', 16, y); pdf.setFont('helvetica', 'normal'); pdf.text(datePart(date), 42, y); y += 10;
  pdf.setFillColor(232, 240, 250); pdf.rect(16, y - 5, width - 32, 8, 'F');
  pdf.setFont('helvetica', 'bold'); pdf.text('Item', 18, y); pdf.text('Qtd.', width - 67, y, { align: 'right' }); pdf.text('Unitário', width - 43, y, { align: 'right' }); pdf.text('Total', width - 18, y, { align: 'right' }); y += 7;
  pdf.setFont('helvetica', 'normal');
  for (const item of items) {
    if (y > 265) { pdf.addPage(); y = 18; }
    const qty = Number(item.qty ?? item.quantity ?? 0);
    const unitPrice = Number(item.price ?? item.unit_price ?? 0);
    const lineTotal = Number(item.total ?? qty * unitPrice);
    const nameLines = pdf.splitTextToSize(String(item.name || 'Item'), width - 118);
    pdf.text(nameLines, 18, y);
    pdf.text(String(qty), width - 67, y, { align: 'right' });
    pdf.text(formatMoney(unitPrice), width - 43, y, { align: 'right' });
    pdf.text(formatMoney(lineTotal), width - 18, y, { align: 'right' });
    y += Math.max(6, nameLines.length * 4.5);
  }
  y += 4;
  const totals = [['Subtotal', subtotal], ['Desconto', -discount], ['Acréscimo', addition], ['Total', total]];
  for (const [label, value] of totals) {
    if (!value && label !== 'Total') continue;
    pdf.setFont('helvetica', label === 'Total' ? 'bold' : 'normal');
    pdf.text(label, width - 76, y); pdf.text(formatMoney(value), width - 18, y, { align: 'right' }); y += 6;
  }
  if (nonFiscal) {
    y += 8; pdf.setFont('helvetica', 'italic'); pdf.setFontSize(8); pdf.setTextColor(100, 116, 139);
    pdf.text('Comprovante comercial para conferência. Não tem validade fiscal e não comprova recolhimento de tributos.', 16, y, { maxWidth: width - 32 });
  }
  return pdf;
}

export function createQuotePdf(quote, company, customerName = '') {
  return drawDocument({ title: 'ORÇAMENTO', reference: quoteReference(quote), company, customer: { name: customerName || quote?.customer_name }, date: quote?.created_at, items: quote?.items, subtotal: quote?.subtotal, discount: quote?.discount, addition: quote?.addition, total: quote?.total });
}

export function downloadQuotePdf(quote, company, customerName = '') {
  const pdf = createQuotePdf(quote, company, customerName);
  pdf.save(`${quoteReference(quote)}.pdf`);
}

export function printQuote(quote, company, customerName = '') {
  const pdf = createQuotePdf(quote, company, customerName);
  pdf.autoPrint();
  const url = pdf.output('bloburl');
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function createSaleReceiptPdf(sale, company) {
  const reference = saleReference(sale);
  return drawDocument({ title: 'COMPROVANTE DE VENDA', reference, company, customer: { name: sale?.customer_name }, date: sale?.sale_date || sale?.created_at, items: sale?.items, subtotal: sale?.subtotal, discount: sale?.discount, addition: sale?.addition, total: sale?.total, nonFiscal: true });
}

export function downloadSaleReceiptPdf(sale, company) {
  const pdf = createSaleReceiptPdf(sale, company);
  pdf.save(`${reference}-nao-fiscal.pdf`);
}

export function buildQuoteShareText(quote, company, customerName = '') {
  const ref = quoteReference(quote);
  const currency = ['BRL', 'USD', 'EUR'].includes(company?.currency) ? company.currency : 'BRL';
  const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(Number(quote?.total || 0));
  return [`Orçamento ${ref}`, company?.name || 'F7 PRO BUSINESS', customerName ? `Cliente: ${customerName}` : '', `Validade: ${quote?.valid_until || 'não informada'}`, `Total: ${total}`, 'Proposta sujeita à confirmação.'].filter(Boolean).join('\n');
}

export function openWhatsAppDraft(phone, message) {
  const digits = String(phone || '').replace(/\D/g, '');
  const query = new URLSearchParams({ text: message });
  const url = `https://wa.me/${digits}?${query.toString()}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return url;
}
