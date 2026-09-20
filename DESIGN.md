# Design notes

## Problem thesis

Accounts-payable analysts spend disproportionate time on invoice exceptions rather than clean invoices. A duplicated invoice may be an accidental resend, a legitimate recurring charge, a credit memo, or a corrected invoice with a different number. The distinction often lives across layout, dates, purchase-order references, service periods, and the surrounding document context.

The cost is not only overpayment. Analysts also spend time opening documents, comparing values, and writing back to suppliers. A useful harness should reduce investigation time without pretending that a model can make a safe payment decision by itself.

The thesis is deliberately narrow: **an AP analyst should be able to resolve one suspicious invoice pair in minutes, with an evidence trail they can defend, instead of manually comparing several documents and guessing whether a resend is legitimate**.

AI fits the unstructured part of the problem: invoices arrive in different layouts, and the meaning of a duplicate often depends on service periods, line descriptions, and context rather than one exact key. AI is not a good fit for the final payment decision, accounting policy, or irreversible ERP action; those remain deterministic or human-controlled.

## User and interface

The user is an AP analyst working through a busy AP inbox. They want to know three things quickly:

1. Why did this case get flagged?
2. What evidence agrees or disagrees?
3. What is the safest next step?

The interface is a simulated inbox plus an evidence-first agent workspace. The analyst selects a message on the left, and the agent explains what it found on the right before opening the document comparison. It uses plain labels, side-by-side invoice metadata, a field-level extraction audit, and explicit actions. The result is useful even when the live model is unavailable.

The chat is intentionally scoped to the selected thread. It is not a general-purpose chatbot: the agent can use invoice-review capabilities, but every recommendation must connect back to the current email, attachment, or reference document.

## Harness architecture

```text
PDF/text files
      |
      +--> pdf.js text layer --------------------+
      |                                           |
      +--> rendered page --> Tesseract WASM -----+--> deterministic fields
      |                                           |
      +--> rendered page --> optional vision ---- +--> model fields
                                                  |
                              field reconciler <--+
                                      |
                              duplicate scorer
                                      |
                          evidence + next action
```

The future email connector is represented by `samples/inbox/`. In production, the connector would provide message text, attachments, sender, and thread metadata. In the POC, those inputs are local fixtures so anybody can clone the repo and reproduce the same agent behavior.

The agent's capabilities are intentionally narrow: scan the inbox, extract an invoice, find similar invoices, compare evidence, validate totals, and prepare a draft next step. Context is assembled per thread rather than sending the whole inbox to the model. Session state contains the selected thread and recent review; a durable implementation would persist case decisions and supplier policy separately.

The back end now exposes those capabilities as explicit local APIs. A chat turn is not a direct free-form model call: it enters an agent controller, which selects an allowlisted tool sequence, returns a structured assistant message, and records a bounded case-scoped memory entry. This makes the harness inspectable in a demo and gives a future model a safe boundary to operate inside.

The initial loop is intentionally deterministic. It is a vertical slice of the control plane, not a claim that the agent already plans arbitrary work. The vision model remains an optional extraction tool. The next model-backed step would be to let a model select among the same tools while keeping the controller responsible for schemas, evidence, and confirmation boundaries.

The deterministic path is the control. It uses local extraction, rules, normalization, and arithmetic validation. The model path is parallel rather than hidden behind the OCR path so reviewers can see disagreement. A field is not treated as “more true” just because the model returned it; conflicts remain visible.

The duplicate scorer is intentionally explainable. The strongest signals are same vendor, same invoice number, same total, same PO, and overlapping service period. A different service period suppresses duplicate confidence and supports the recurring-charge explanation.

## Failure handling and guardrails

- Missing fields are shown as missing, not filled by inference.
- OCR/model disagreement becomes a conflict that needs review.
- A low-quality scan reports that OCR confidence may be incomplete.
- No payment or ERP action is executed.
- A missing API key leaves the deterministic path available and labels the demo adapter.
- Uploaded PDF content is processed in the browser before an optional model request.
- The app uses synthetic fixtures by default and does not persist documents.
- The chat cannot execute payment, ERP, or outbound-email actions; those remain human-confirmed or out of scope.

## Evaluation

The included fixtures cover:

- Exact resubmission: same vendor, invoice number, total, PO, and service period.
- Legitimate recurring invoice: same vendor and amount, different period and invoice number.
- Editable text input for quickly changing one signal and seeing the score move.

With more time, the next evaluation set would include scanned invoices, credit memos, currency formats, corrected invoice numbers, and intentionally conflicting OCR/model outputs. Metrics would be field extraction accuracy, duplicate false-positive rate, and the percentage of cases where an analyst can explain the suggested action from displayed evidence.

For this vertical slice, the quality bar is intentionally observable rather than implied:

- The deterministic path is covered by automated tests for extraction, amount parsing, duplicate scoring, recurrence, and conflict handling.
- The demo contains both a likely resubmission and a legitimate recurring invoice so the harness has to distinguish them.
- Every suggested classification exposes the signals that contributed to it.
- Model disagreement is a visible state, not silently overwritten.
- A reviewer can change one value in `samples/`, re-run the flow, and see the result move.

The next useful evaluation step would be an annotated set of 20-30 synthetic invoices with expected fields and expected duplicate decisions. That would let us measure whether the model adds signal over the deterministic baseline instead of assuming that it does.

## Tradeoffs

The browser-based OCR path avoids system-level Tesseract and Poppler dependencies, which makes cloning the repository simpler. The tradeoff is a larger first-load and the need to download WASM/language assets in the browser. The model adapter is server-side so API keys are not exposed, but it is optional and requires network access.

The repository also ships a multi-stage Docker image and Compose file. Docker packages the compiled UI and local agent API together so a reviewer can run the POC without matching the author's Node version. The tradeoff is the usual requirement that Docker Desktop or a compatible Docker runtime is installed.

The POC intentionally stops at a single analyst workspace. An ERP connector, persistence, permissions, audit logs, and outbound communications would be the next product layer, not prerequisites for demonstrating the harness.

## Reflections

Time spent: approximately one focused half-day on problem framing, implementation, documentation, and verification. The scope was kept intentionally small so the workflow could run end to end from a fresh clone.

The least certain assumption is that the duplicate decision can be made from invoice documents alone. In a real AP environment, the payment ledger, goods-received record, credit memo history, and supplier-specific policy may be necessary. The harness therefore treats its result as a review queue signal, not an accounting truth.

With more time, I would add real PDF fixtures from several layouts, a small labeled evaluation set, a review feedback loop, and an ERP export connector. I would also test whether the model path materially improves recall on scanned or irregular invoices before making it a default rather than an escalation path.
