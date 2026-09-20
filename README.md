# Ledgerline / Invoice Exception Desk

Ledgerline is a small, portable AI harness for accounts-payable analysts. It presents a simulated AP inbox on the left and a tool-using agent on the right. The agent reviews invoice attachments, extracts important fields through two independent paths, and explains whether a pair looks like an accidental duplicate or a legitimate recurring charge.

The product is intentionally a decision-support slice: it does not block a payment, update an ERP, or send an email. It gives the analyst evidence and a safe next action.

## Run it locally

Requirements: Node.js 20 or newer.

### Recommended: Docker

Docker is the most reproducible path for reviewers. No local Node installation or API key is required:

```bash
docker compose up --build
```

Open `http://localhost:8787`. Stop it with:

```bash
docker compose down
```

The container runs the compiled front end and the local agent API together. It starts in deterministic demo mode, so the inbox, tool traces, memory, and sample review flow work without external services.

To enable the optional vision model, create a local `.env` from `.env.example`, add the key, and start Compose again:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=your_supported_vision_model
```

The `.env` file is ignored by Git and is not copied into the image.

### Without Docker

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

## Agent API surface

The local server exposes the capabilities used by the workspace:

- `GET /api/inbox` returns the simulated AP inbox.
- `GET /api/capabilities` lists the agent's allowed tools.
- `POST /api/agent/run` runs a case-scoped agent turn.
- `POST /api/reviews` saves a human decision in the current local session.
- `GET /api/memory?threadId=...` inspects the current case memory.
- `POST /api/model-extract` runs the optional vision extraction adapter.

The first agent loop is deterministic and local so the repository works without a model key. It already exposes tool traces, case-scoped memory, and output guardrails. The model adapter can be introduced behind the same capability boundary without changing the front-end contract.

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
- Local agent APIs for inbox, capabilities, tool traces, review decisions, and case memory.

Stubbed or deliberately omitted:

- ERP/AP ledger integration.
- A live Gmail, Outlook, or IMAP inbox connector; `samples/inbox/` is the transparent local stub.
- A fully autonomous planning loop; the first agent loop is deliberately controlled and deterministic.
- Actual payment blocking or approval.
- Email delivery.
- Persistent database and user authentication.
- Production-grade invoice classification for every supplier layout.

The demo model adapter is intentionally visible when no API key exists. It allows reviewers to inspect the full harness without a secret, while the Anthropic adapter shows where a real vision model plugs in.

## Design notes

See [`DESIGN.md`](DESIGN.md) for the problem thesis, harness architecture, failure handling, evaluation approach, and tradeoffs.
