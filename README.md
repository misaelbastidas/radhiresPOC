# Ledgerline / Invoice Exception Desk

Ledgerline is a small, portable AI harness for accounts-payable analysts. It presents a simulated AP inbox on the left and a tool-using agent on the right. The agent reviews invoice attachments, extracts important fields through two independent paths, and explains whether a pair looks like an accidental duplicate or a legitimate recurring charge.

The product is intentionally a decision-support slice: it does not block a payment, update an ERP, or send an email. It gives the analyst evidence and a safe next action.

## Run it locally

Requirements: Node.js 20 or newer.

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`. The first screen already includes ten synthetic inbox threads. Click a message to see the agent work on that context, then inspect the evidence workspace below.

For frontend development, use two terminals:

```bash
# terminal 1
npm run dev:api

# terminal 2
npm run dev
```

Then open `http://localhost:5173`.

No API key is required. The sample pack and the editable fixtures in [`samples/`](samples/) run with the demo model adapter. The app labels that response clearly; it is not presented as a live model result.

## Try the sample inbox

The [`samples/inbox/`](samples/inbox/) folder is the simulated email intake layer. It contains ten editable message fixtures covering exact resubmissions, recurring charges, corrected invoices, missing POs, credit memos, changed amounts, and low-quality scans.

The live UI loads these fixtures without needing an email provider. The first three threads link to editable invoice fixtures in `samples/`. This keeps the demo reproducible while making the future Gmail/Outlook connector boundary explicit.

## Try your own invoices

1. Click **Import invoice files**.
2. Select two or more PDF invoices from the same vendor, or select `.txt`/`.md` fixtures while iterating on a case.
3. The browser renders the PDF and extracts digital text locally. Scanned pages fall back to Tesseract.js/WASM in the browser.
4. The app compares fields and scores duplicate signals.
5. Review the evidence and select a simulated next action.

For a live model extraction, copy `.env.example` to `.env` and add:

```text
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=your_supported_vision_model
PORT=8787
```

Restart `npm start`. The API key stays server-side; it is never placed in browser code.

## What is real vs. stubbed

Real in this slice:

- PDF page rendering with `pdf.js`.
- Digital PDF text extraction.
- Browser OCR fallback with Tesseract.js/WASM.
- Deterministic field parsing and total arithmetic checks.
- Parallel model adapter and field-level reconciliation.
- Duplicate scoring using vendor, invoice number, amount, PO, dates, and service periods.
- Local action state and review-note copy.
- A conversational agent workspace over a simulated inbox with case-scoped prompts.

Stubbed or deliberately omitted:

- ERP/AP ledger integration.
- A live Gmail, Outlook, or IMAP inbox connector; `samples/inbox/` is the transparent local stub.
- Actual payment blocking or approval.
- Email delivery.
- Persistent database and user authentication.
- Production-grade invoice classification for every supplier layout.

The demo model adapter is intentionally visible when no API key exists. It allows reviewers to inspect the full harness without a secret, while the Anthropic adapter shows where a real vision model plugs in.

## Design notes

See [`DESIGN.md`](DESIGN.md) for the problem thesis, harness architecture, failure handling, evaluation approach, and tradeoffs.
