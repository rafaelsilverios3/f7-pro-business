# Marcos de homologação do F7 Business

## 2026-10-12 — F7 Supplier Offers

**Resultado informado:** GO para o escopo funcional e de segurança efetivamente testado em homologação.

**Ambiente:** Preview da branch `codex/harden-multi-tenant-isolation`; Supabase de homologação `f7-pro-business-homolog` (`vwylnjmapixtzhryiutt`). Produção não faz parte deste marco.

**Evidências registradas no encerramento da homologação:**

- Isolamento entre Empresas Homolog A e B nas verificações executadas.
- Operações não autorizadas do papel Vendedor foram bloqueadas.
- A fixture fictícia permaneceu íntegra após as tentativas controladas.
- O estoque próprio permaneceu preservado.
- A interface da aba Ofertas recuperou o carregamento após o erro controlado.
- O harness de homologação utilizado está em `src/pages/homologation/suites/SupplierOffersSuite.jsx` e `src/pages/homologation/suites/supplierOffersChecks.js`; os testes estruturais estão em `tests/homologation-rest-runner.test.mjs` e as verificações de fundação em `tests/supplier-offers.test.mjs`.

**Limite de evidência preservado:** o encerramento fornecido ao repositório não incluiu exportação dos resultados REST, códigos HTTP por operação, identificadores da fixture ou capturas da execução. Portanto, este registro preserva o resultado e os itens confirmados pelo responsável pela homologação, mas não inventa códigos, contagens ou artefatos brutos. Esta anotação não amplia o GO para recursos ou operações que não foram testados.

**Fora do escopo:** produção, publicações em marketplaces, integrações externas, dados reais de clientes/fornecedores e validações de módulos não abrangidas pelas provas acima.

