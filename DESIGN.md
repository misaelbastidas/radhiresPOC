# Ledgerline Invoice Review Harness — Design Document

- **The problem thesis**

  - Accounts-payable analysts spend a large part of their day investigating invoice exceptions: opening PDFs, comparing values, checking whether a resend is legitimate, and writing back to suppliers. The cost is operational time, delayed approvals, and the risk of paying a duplicate or escalating a legitimate recurring charge as an error.
  - This POC targets invoice classification on request. An analyst can ask whether the documents in a case look like a duplicate, a recurring charge, a corrected invoice, a credit memo, or a normal invoice. The system must explain its proposal with evidence rather than produce an unexplained score.
  - AI fits the unstructured part of this problem. Invoices arrive in different layouts, and the meaning of a duplicate may depend on line descriptions, service periods, purchase orders, or the surrounding message. Deterministic extraction, normalization, arithmetic checks, and similarity signals provide the control layer; the LLM helps interpret the case, select approved capabilities, and communicate the result.
  - The LLM does not approve payment or make an irreversible accounting decision.
  - **Thesis:** an AP analyst should be able to resolve a suspicious invoice case in minutes, with a reviewable evidence trail and a human decision point, instead of manually comparing several documents and guessing what to do next.

- **The end user & the interface**

  - The end user is an AP analyst working through a supplier-invoice queue. Their practical questions are:
    - What did the agent find?
    - Which fields and documents support that conclusion?
    - What should I do next, and can I safely ask the supplier for clarification?
  - The POC uses a centered, agent-first chat workspace. The analyst chooses a local sample case or attaches invoice PDFs, then explicitly asks the agent to classify invoices, compare evidence, validate totals, or draft a supplier reply.
  - The response contains the proposed result, relevant evidence, a compact tool trace, and human decision controls. Drafted replies are never sent automatically.
  - Chat is intentional: the analyst starts with a question or instruction, not an automatic background process. It keeps the scope of each turn visible and makes the human approval boundary clear.
  - The interface looks familiar to an analyst, but it is narrower than a general chatbot: the agent can only work with the selected case and the capabilities exposed by the harness.

- **Architecture & the harness**

  ```text
  sample inbox / uploaded PDFs
               |
               v
   deterministic OCR + optional vision extraction
               |
               v
   field reconciliation + arithmetic validation
               |
               v
   allowlisted tools <-> bounded agent workflow
               |
               v
   evidence-backed proposal -> human review -> optional draft copy
  ```

  - The POC is packaged as a Node/React application with Docker Compose so another person can clone the repository, add or modify samples, and run the same flow locally.
  - Deterministic extraction uses the PDF text layer, browser-compatible OCR, normalization, and invoice-math rules. An optional Anthropic Claude vision call produces a second field set for irregular layouts.
  - The reconciler compares both field sets. Disagreement remains visible as a conflict instead of being silently overwritten.
  - The agent exposes six narrow capabilities: scan the inbox, extract an invoice, find similar invoices, compare documents, validate invoice math, and draft a vendor message.
  - The LLM proposes which capability to use. The executor validates the arguments and runs deterministic application code; the model cannot invent an API call, execute arbitrary code, or send an email.
  - Context and memory are separate:
    - **Session context:** selected thread, linked documents, extracted fields, current instruction, and current tool results. It is rebuilt and bounded for each request.
    - **Review memory:** a small case-scoped record of prior analyst decisions and review events. Only recent, relevant events are injected into a later turn.
    - **External knowledge:** intentionally out of scope. There is no RAG layer because the task is limited to the selected invoice case and local fixtures.
  - The harness uses LangChain for typed model/tool interfaces and LangGraph for the bounded `agent -> tools -> agent -> final` workflow. The provider model is configurable and defaults to Claude Sonnet 4.6 in the local demo.
  - Failure and quality controls are part of the harness:
    - Input guardrails reject unsupported files, malformed tool requests, oversized context, and instructions outside invoice review.
    - Tool guardrails enforce an allowlist, typed arguments, bounded document access, and no payment, ERP, or outbound-email side effects.
    - Output guardrails require structured results, displayed evidence, uncertainty when fields are missing or conflicting, and a human-review state for consequential decisions.
    - A missing model key, provider failure, OCR weakness, or trace outage leaves the deterministic path available and reports the limitation.
    - A maximum tool-iteration budget prevents loops. Missing fields remain missing; the system does not fill them by inference.
    - The included corpus evaluation covers ten synthetic automotive-parts cases, including exact resubmissions, recurring purchases, corrected invoices, credit memos, missing fields, and low-quality scans.

- **Tooling & tradeoffs**

  - The main tradeoff is control versus convenience. A deterministic-only system would be easier to reason about but less useful for varied layouts and natural-language requests. A model-only system would be flexible but too difficult to audit safely.
  - This design keeps deterministic code responsible for extraction checks, arithmetic, normalization, scoring, and side effects, while the model handles bounded orchestration and explanation.
  - The browser-compatible OCR path avoids requiring Poppler or a system Tesseract installation, improving portability. The tradeoff is a larger client bundle and slower first extraction.
  - The optional vision path can improve irregular documents, but it adds latency, cost, and another failure mode, so it is never the sole source of truth.
  - The chat interface was chosen over a full inbox dashboard because the POC demonstrates agent behavior and human control, not queue management. The selected-case control still provides reproducible fixtures.
  - Real email, ERP, payment, persistence, permissions, and production outbound messaging are intentionally excluded; adding them would expand the risk surface before the core harness is proven.
  - Docker Compose makes the runtime reproducible across machines, while `.env` keeps provider credentials outside the repository. The app remains usable offline and with the deterministic fallback.

- **Reflections**

  - This vertical slice took approximately one focused half-day across problem framing, implementation, documentation, and verification. The scope was kept small enough to run end to end from a fresh clone while still exposing the important harness boundaries.
  - The least certain assumption is that invoice documents and message context are enough to classify a duplicate. In a real AP operation, the payment ledger, purchase order, goods-received record, credit-memo history, and supplier policy may change the answer.
  - The agent should therefore be treated as review support, not accounting truth.
  - Next steps would be to add more layouts and languages, create an annotated evaluation set with field-level and classification metrics, measure whether the model improves recall over the deterministic baseline, and persist analyst decisions for feedback.
  - Only after those tests would I add a real email connector and a separately approved outbound-message tool with authorization, audit logs, and an explicit confirmation step.
