# Company knowledge and assistant feedback

`company_knowledge` is the canonical company-scoped store for verified facts, resolved cases, customer preferences, supplier knowledge and product knowledge. Every active fact carries its source, confidence, scope, verification timestamp and verifier. The existing `verified_product_applications` table remains the canonical application-specific structure.

`assistant_feedback` is an immutable audit trail. A successful human send records whether the suggestion was accepted unchanged or edited; dismissing a suggestion records rejection. Part or application confirmations can be promoted to active knowledge only through an explicit admin/manager RPC. Promotion supersedes the previous active fact with the same company, type, subject and key. No feedback automatically trains a model or becomes verified knowledge.

The assistant reads only active knowledge for its current company and passes a bounded representation to the provider. The migration keeps RLS enabled, validates the referenced conversation under the same company, and gives `service_role` only the access needed for server-side context reads.

Migration `0044_company_knowledge_feedback.sql` must be applied manually after 0043. Conceptual rollback disables knowledge reads in the assistant first, exports the immutable feedback, revokes and drops the promotion RPC and policies, then drops the 0044 tables only after the data-retention decision is recorded.
