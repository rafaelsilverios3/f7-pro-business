# AI Security

## Trust boundaries

The browser holds only public Supabase configuration and the signed-in user's session. Supabase Edge Functions hold service-role and provider credentials. Meta, OpenAI and Brave are never called directly from frontend code.

Every request resolves an authenticated user, active company membership, permission and feature entitlement before company data is read. Server-side queries include `company_id`; new persistence tables use RLS, company-scoped policies, indexes and explicit grants. Service-role access is limited to the operations each backend flow needs.

## Untrusted input

Customer messages, company rules and web pages are data. They cannot change system policy, select another company, request credentials, enable a feature, grant permission, invoke tools directly or authorize an action. Tool selection uses the registry and schemas; execution uses independent server-side policy.

External URLs pass protocol, hostname, DNS/IP and redirect checks. Private, loopback and link-local networks are blocked. Research has query/result/page/time/cost bounds and sanitizes fetched text before candidate extraction.

## Execution policy

Model output is validated against a strict decision/response contract. Assisted output remains editable and requires a human send. Automatic output runs only through an atomically claimed job, stable idempotency key and independent policy check. Low confidence, conflicts and restricted actions create handoff or remain blocked. Sale, payment, stock, price, credit and purchase mutations require dedicated authorization and transactional server-side operations.

## Logging and errors

Operational traces store safe stages, durations, provider/status codes, counts, tool names, source domains, confidence and candidate counts. They exclude API keys, access tokens, headers, prompts, full customer messages and raw provider bodies. Public errors use stable codes and never expose stacks, SQL or privileged configuration.

CI bundles every Edge Function, validates migration ordering/RLS/grants and scans frontend sources for privileged environment identifiers and direct provider endpoints.
