import React, { useState, useEffect } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { Building2, Users, Package, ShoppingCart, LayoutDashboard, Check, ChevronRight } from 'lucide-react';
import { salesService } from '@/services/salesService';
import { customersService } from '@/services/customersService';
import { productsService } from '@/services/productsService';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompany } from '@/lib/useCompany';
import { getDataProvider } from '@/data/providerSelector';

const STEPS = [
  { id: 'company', label: 'Configurar empresa', icon: Building2 },
  { id: 'customer', label: 'Cadastrar cliente', icon: Users },
  { id: 'product', label: 'Cadastrar produto', icon: Package },
  { id: 'sale', label: 'Registrar primeira venda', icon: ShoppingCart },
  { id: 'dashboard', label: 'Visualizar Dashboard', icon: LayoutDashboard },
];

export default function Onboarding() {
  const { company } = useOutletContext();
  const { createCompany } = useCompany();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [done, setDone] = useState({});
  const [form, setForm] = useState({ customerName: '', customerPhone: '', productName: '', productPrice: '', productCost: '' });
  const [createdCustomer, setCreatedCustomer] = useState(null);
  const [createdProduct, setCreatedProduct] = useState(null);
  const [companyName, setCompanyName] = useState('');
  const [companyError, setCompanyError] = useState('');
  const [creatingCompany, setCreatingCompany] = useState(false);

  useEffect(() => {
    if (company?.onboarding_completed) {
      setDone({ company: true, customer: true, product: true, sale: true, dashboard: true });
    }
  }, [company]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const completeStep = (id) => {
    setDone((p) => ({ ...p, [id]: true }));
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const saveCompany = async () => {
    await getDataProvider().entity('Company').update(company.id, { onboarding_completed: true });
    completeStep('company');
  };

  const saveCustomer = async () => {
    if (!form.customerName) return;
    const c = await customersService.create(company.id, {
      company_id: company.id, name: form.customerName, phone: form.customerPhone,
      status: 'active', type: 'pf', total_purchased: 0, sale_count: 0, avg_ticket: 0,
    });
    setCreatedCustomer(c);
    completeStep('customer');
  };

  const saveProduct = async () => {
    if (!form.productName) return;
    const p = await productsService.create(company.id, {
      company_id: company.id, name: form.productName,
      price: Number(form.productPrice) || 0,
      cost: Number(form.productCost) || 0,
      stock: 10, minimum_stock: 2, active: true,
    });
    setCreatedProduct(p);
    completeStep('product');
  };

  const saveSale = async () => {
    if (!createdCustomer || !createdProduct) { completeStep('sale'); return; }
    await salesService.finalize(company.id, {
      customer_id: createdCustomer.id,
      customer_name: createdCustomer.name,
      items: [{ product_id: createdProduct.id, name: createdProduct.name, qty: 1, price: createdProduct.price ?? createdProduct.sale_price ?? 0, cost: createdProduct.cost ?? createdProduct.cost_price ?? 0 }],
      seller: 'Você',
      payment_method: 'Pix',
    });
    completeStep('sale');
  };

  const finish = () => {
    navigate('/');
  };

  const skipAll = () => {
    getDataProvider().entity('Company').update(company.id, { onboarding_completed: true });
    navigate('/');
  };

  const current = STEPS[step];
  const allDone = STEPS.every((s) => done[s.id]);

  if (!company) return (
    <div className="mx-auto max-w-lg px-5 py-16">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900">Crie sua empresa</h1>
        <p className="mt-2 text-sm text-slate-500">Sua conta ainda não possui uma empresa. Informe o nome para iniciar o F7 PRO BUSINESS.</p>
        {companyError && <p className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{companyError}</p>}
        <form className="mt-5 space-y-3" onSubmit={async (event) => { event.preventDefault(); setCompanyError(''); setCreatingCompany(true); try { await createCompany(companyName); } catch (error) { setCompanyError(error.message || 'Não foi possível criar a empresa.'); } finally { setCreatingCompany(false); } }}>
          <Label htmlFor="company-name">Nome da empresa</Label>
          <Input id="company-name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="Ex: F7 Comércio" required minLength={2} />
          <Button type="submit" className="w-full" disabled={creatingCompany}>{creatingCompany ? 'Criando...' : 'Criar empresa e continuar'}</Button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bem-vindo ao F7 PRO BUSINESS</h1>
          <p className="mt-1 text-sm text-slate-500">Vamos configurar sua conta em poucos passos.</p>
        </div>
        <Button variant="ghost" onClick={skipAll} className="text-xs">Pular introdução</Button>
      </div>

      {/* Progress */}
      <div className="mb-8 flex items-center gap-2">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.id}>
            <div className={`flex h-9 w-9 items-center justify-center rounded-full ${done[s.id] ? 'bg-emerald-500 text-white' : i === step ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400'}`}>
              {done[s.id] ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
            </div>
            {i < STEPS.length - 1 && <div className={`h-0.5 flex-1 rounded ${done[s.id] ? 'bg-emerald-500' : 'bg-slate-200'}`} />}
          </React.Fragment>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            <current.icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-900">{current.label}</p>
            <p className="text-xs text-slate-400">Passo {step + 1} de {STEPS.length}</p>
          </div>
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Sua empresa <strong>{company?.name}</strong> está pronta. Confirme para continuar.</p>
            <Button onClick={saveCompany} className="w-full">Confirmar e continuar <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do cliente *</Label>
              <Input value={form.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Ex: Maria Silva" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Telefone</Label>
              <Input value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} placeholder="(11) 99999-9999" />
            </div>
            <Button onClick={saveCustomer} disabled={!form.customerName} className="w-full">Cadastrar cliente <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do produto *</Label>
              <Input value={form.productName} onChange={(e) => set('productName', e.target.value)} placeholder="Ex: Notebook Pro" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Preço de venda (R$)</Label>
                <Input type="number" step="0.01" value={form.productPrice} onChange={(e) => set('productPrice', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Preço de custo (R$)</Label>
                <Input type="number" step="0.01" value={form.productCost} onChange={(e) => set('productCost', e.target.value)} />
              </div>
            </div>
            <Button onClick={saveProduct} disabled={!form.productName} className="w-full">Cadastrar produto <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">
              Vamos registrar sua primeira venda com o cliente e produto cadastrados.
              {createdCustomer && createdProduct && ` (${createdCustomer.name} → ${createdProduct.name})`}
            </p>
            <Button onClick={saveSale} className="w-full">Registrar venda <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">Tudo pronto! Seu dashboard está atualizado com a primeira venda. Estoque, financeiro e cliente já foram integrados automaticamente.</p>
            <Button onClick={finish} className="w-full bg-emerald-600 hover:bg-emerald-700">Ir para o Dashboard <ChevronRight className="ml-1 h-4 w-4" /></Button>
          </div>
        )}

        {step < STEPS.length - 1 && !done[current.id] && (
          <button onClick={() => setStep(step + 1)} className="mt-3 w-full text-center text-xs text-slate-400 hover:text-slate-600">Pular este passo</button>
        )}
      </div>
    </div>
  );
}
