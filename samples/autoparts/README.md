# Automotive parts sample corpus

This is the canonical editable corpus for the local Ledgerline demo. It uses a fictional automotive-parts AP operation so the cases include SKUs, purchase orders, quantities, freight, corrections, returns, and recurring fleet services.

The corpus contains 10 inbox cases, 14 digital invoice PDFs, and one two-page image-only scan. The expected outcome for each case is recorded in `manifest.json` so another reviewer can understand what the harness is supposed to recognize.

Each case has a generated PDF in `pdf/`. The digital PDFs contain a text layer; `scanline-9008-low-confidence-rebuilt.pdf` is image-only and is meant to activate the browser OCR fallback. Editable text sources live in `fixtures/autoparts/` so the runnable sample folder stays focused on actual invoice inputs.

Coverage:

1. Exact resubmission of AM-2026-1042.
2. A reference copy of the same invoice.
3. Legitimate recurring purchase of the same brake-pad SKU in February.
4. Corrected rotor invoice with a changed total.
5. Freight invoice with a missing PO.
6. Credit memo for returned alternators, not a second invoice.
7. Clear invoice with no duplicate reference.
8. Revised hub quantity and total.
9. Legitimate recurring monthly fleet maintenance.
10. Low-confidence scan simulation where evidence must be verified by a human.

To regenerate the PDFs after editing a source, install the generator dependencies with `python -m pip install -r scripts/requirements-pdf.txt`, then run `python scripts/generate_invoice_pdfs.py`. The simulated email intake manifest in `samples/inbox/` points at the PDF files in this corpus. A future connector can replace those fixtures without changing the agent capability contract.
