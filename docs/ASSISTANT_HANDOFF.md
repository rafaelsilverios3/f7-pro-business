# Structured assistant handoff

An assistant handoff is a company-scoped operational dossier linked to one conversation and, when automatic execution initiated it, to one assistant job. It stores only bounded structured facts, unresolved facts, candidate and source summaries, a safe reason code and the research trace. It does not copy the complete conversation or provider credentials.

Only one `pending` or `assigned` handoff can exist for a company/conversation pair. Creation uses a transaction advisory lock, validates the conversation and optional job scope, and moves the conversation to `waiting_human`. An authorized company member can claim it, which assigns the current authenticated user and resumes the conversation as `in_progress`; the same workflow can then resolve or dismiss the dossier.

Automatic jobs create the dossier before entering the terminal `handed_off` state. If dossier creation fails, the job fails with `handoff_create` instead of claiming that a human transfer exists.

Migration `0043_structured_assistant_handoffs.sql` must be applied manually after 0042. Rollback starts by disabling automatic replies, resolving active handoffs, and removing the 0043 RPCs and policies. The table and indexes may be dropped only after the dossiers are exported or no longer required.
