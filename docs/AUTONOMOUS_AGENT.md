# Autonomous assistant execution

Automatic conversation replies use a queue and remain disabled by default. Migration `0041_autonomous_assistant.sql` created the initial company switches and `assistant_jobs`; migration `0042_assistant_job_execution.sql` completes the executable queue without changing any company to automatic mode.

## Flow

1. `whatsapp-webhook` persists and deduplicates the inbound message.
2. Only when `mode = automatic` and `automatic_reply_enabled = true`, it calls the server-only `enqueue_assistant_job` RPC with the company, conversation, stored message and provider message identifier.
3. The unique provider identifier and unique stored message index make enqueue idempotent.
4. `assistant-worker` claims one queued job through `FOR UPDATE SKIP LOCKED`; a concurrent worker cannot claim the same job.
5. The worker calls the existing `assistant-suggest` pipeline through a service-role-authenticated internal request. The conversation and processing job must match the same company.
6. The orchestrator produces an `AssistantDecision`. A separate policy module checks company mode, explicit enablement, decision authorization, human-review requirements, safe action type and response size.
7. The `authorize_assistant_job_delivery` RPC atomically records the delivery attempt before the provider call. A retry cannot call Meta again for the same job. This chooses at-most-once delivery to prevent duplicate automatic replies; an uncertain provider outcome is handed to operations instead of blindly retried.
8. Human and automatic WhatsApp messages use the same server-side `sendWhatsAppText` implementation. It derives the destination and Phone Number ID from company-owned database records and uses only server secrets.

## States and retries

Jobs use `queued`, `processing`, `waiting_input`, `completed`, `failed`, or `handed_off`. AI/provider failures before the delivery claim can return to `queued`, with a maximum of three claims. Failures after the delivery claim are terminal because retrying an external send could duplicate a message.

## Safety gates

Automatic mode is not auto-sale. The policy permits only response actions and blocks quotes, sales, payments, stock changes, price changes and every transactional tool. `anon` and `authenticated` receive no access to the queue or its RPCs. RLS stays enabled, all stored rows carry `company_id`, and `assistant-suggest` validates the job against the conversation before using the internal path.

The independent delivery policy rechecks both the orchestrator confidence and the provider response confidence against `auto_reply_min_confidence`. The 0041 `allow_product_lookup` field is the single catalog lookup switch; 0042 does not introduce a competing `allow_catalog_lookup` field.

Migration 0042 must be applied manually before deploying `whatsapp-webhook`, `assistant-worker`, `assistant-suggest`, and the refactored `whatsapp-send`. Until then, the production assisted mode remains the active safe path.

## Conceptual rollback

First set `automatic_reply_enabled = false` for every company and keep the worker unavailable; queued rows can then be inspected without producing replies. After every processing job has reached a terminal or waiting state, remove the four 0042 RPCs, the two 0042 indexes and the columns added by 0042 if a schema rollback is still required. Keep the stored inbound messages and conversation history. Do not drop 0041 or queue data while a worker may still be running.
