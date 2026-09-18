# Design notes

## Problem thesis

Accounts-payable analysts spend disproportionate time on invoice exceptions rather than clean invoices. A duplicated invoice may be an accidental resend, a legitimate recurring charge, a credit memo, or a corrected invoice with a different number. The distinction often lives across layout, dates, purchase-order references, service periods, and the surrounding document context.

The cost is not only overpayment. Analysts also spend time opening documents, comparing values, and writing back to suppliers. A useful harness should reduce investigation time without pretending that a model can make a safe payment decision by itself.

## User and interface

The user is an AP analyst working through a queue of exceptions. They want to know three things quickly:

1. Why did this case get flagged?
2. What evidence agrees or disagrees?
3. What is the safest next step?

The interface is a queue plus an evidence-first case workspace. It uses plain labels, side-by-side invoice metadata, a field-level extraction audit, and explicit actions. The result is useful even when the live model is unavailable.

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

## Evaluation

The included fixtures cover:

- Exact resubmission: same vendor, invoice number, total, PO, and service period.
- Legitimate recurring invoice: same vendor and amount, different period and invoice number.
- Editable text input for quickly changing one signal and seeing the score move.

With more time, the next evaluation set would include scanned invoices, credit memos, currency formats, corrected invoice numbers, and intentionally conflicting OCR/model outputs. Metrics would be field extraction accuracy, duplicate false-positive rate, and the percentage of cases where an analyst can explain the suggested action from displayed evidence.

## Tradeoffs

The browser-based OCR path avoids system-level Tesseract and Poppler dependencies, which makes cloning the repository simpler. The tradeoff is a larger first-load and the need to download WASM/language assets in the browser. The model adapter is server-side so API keys are not exposed, but it is optional and requires network access.

The POC intentionally stops at a single analyst workspace. An ERP connector, persistence, permissions, audit logs, and outbound communications would be the next product layer, not prerequisites for demonstrating the harness.
