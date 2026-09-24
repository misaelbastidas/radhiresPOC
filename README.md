# Ledgerline / Invoice Exception Desk

Ledgerline is a small, portable AI harness for accounts-payable analysts in an automotive-parts operation. It presents a centered, ChatGPT-like agent workspace with a compact case context. The agent reviews invoice attachments, extracts important fields through two independent paths, and explains whether a pair looks like an accidental duplicate, a legitimate recurring charge, or an exception that needs evidence.

The product is intentionally a decision-support slice: it does not block a payment, update an ERP, or send an email. It gives the analyst evidence and a safe next action.

The component-level plan is documented in [`ARCHITECTURE.md`](ARCHITECTURE.md). The auditable runtime contract is in [`HARNESS_CONTRACT.md`](HARNESS_CONTRACT.md): it enumerates the tools, allowlist, prompt behavior, input/output guardrails, context management, memory management, and human boundary.

The editable draw.io diagrams are in [`LEDGERLINE_AGENT_GRAPH.drawio`](LEDGERLINE_AGENT_GRAPH.drawio). The file contains the LangGraph loop and the separation between current session context and prior review memory.

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

The container runs the compiled front end and the local agent API together. It starts in deterministic demo mode, so the agent, tool traces, memory, and sample review flow work without external services.

To enable the optional Anthropic model for vision extraction and the LangGraph agent, create a local `.env` file, add the key, and start Compose again:

```bash
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=your_supported_anthropic_model
```

The `.env` file is ignored by Git and is not copied into the image.

### Demonstrate the LangChain + LangGraph harness

To exercise the real model path:

```bash
export ANTHROPIC_API_KEY=your_key_here
export ANTHROPIC_MODEL=claude-sonnet-4-6
docker compose up --build
```

Then:

1. Open the app, leave the selected sample case in the context bar, and ask **Classify invoices**.
2. Expand **Show work**. The activity lists the actual allowlisted tool calls and their deterministic results.
3. Confirm that the response remains a proposal and that no payment, ERP update, or outbound email tool exists.

LangChain supplies the model/tool contract and LangGraph owns the stateful `agent → tools → final` loop and checkpoint boundary. The harness is intentionally self-contained; it does not send prompts, invoice content, or traces to an external observability service.

### Without Docker

```bash
npm install
npm run build
npm start
```

Open `http://localhost:8787`. The first screen opens directly in the agent. A compact case selector provides the ten synthetic sample threads, and PDFs can also be attached from the chat context bar. Write what you want the agent to do, for example `Classify these invoices`.

For frontend development, use two terminals:

```bash
# terminal 1
npm run dev:api

# terminal 2
npm run dev
```

Then open `http://localhost:5173`.

No API key is required. The sample pack in [`samples/`](samples/) runs with the deterministic fallback adapter. Editable source fixtures live separately in [`fixtures/`](fixtures/) and are only needed when changing the corpus. The app labels the fallback response clearly; it is not presented as a live model result.

## Verify the harness

Run the automated checks from the repository root:

```bash
npm test
npm run build
npm run eval
```

The tests include the ten automotive-parts cases in `samples/autoparts/`, not only the UI smoke path. `npm run eval` prints the expected versus predicted outcome for every corpus case. If you edit a fixture, the expected outcome and the evidence in `samples/autoparts/manifest.json` remain visible for review.

## Try the sample inbox

The [`samples/inbox/`](samples/inbox/) folder contains the simulated email intake manifest. The runnable invoice inputs live in [`samples/autoparts/pdf/`](samples/autoparts/pdf/); editable source text and email bodies are separated under [`fixtures/`](fixtures/). The canonical corpus includes an expected outcome for every case.

The live UI loads the selected sample case through the same browser extraction path used for user uploads. The inbox manifest links email context to invoice PDFs in `samples/autoparts/`. This keeps the demo reproducible while making the future Gmail/Outlook connector boundary explicit without forcing the analyst into an inbox-first layout.

## Try your own invoices

1. Click **Import invoice files**.
2. Select two or more PDF invoices from `samples/autoparts/pdf/`.
3. The browser renders the PDF and extracts digital text locally. The Scanline sample is image-only, so it falls back to Tesseract.js/WASM in the browser.
4. The app compares fields and scores duplicate signals.
5. Review the evidence and select a simulated next action.

For a live model extraction, create `.env` and add:

```text
ANTHROPIC_API_KEY=your_key_here
ANTHROPIC_MODEL=your_supported_anthropic_model
REPLY_FROM_NAME=Your name or AP team name
PORT=8787
```

Restart `npm start`. The API key stays server-side; it is never placed in browser code.

## Agent API surface

The local server exposes the capabilities used by the workspace:

- `GET /api/inbox` returns the simulated AP inbox.
- `GET /api/sample-file?name=...` returns an allowlisted local sample PDF for the selected thread.
- `GET /api/capabilities` lists the agent's allowed tools and returns the auditable harness contract.
- `POST /api/agent/run` runs a case-scoped agent turn.
- `POST /api/reviews` saves a human decision in the current local session.
- `GET /api/memory?threadId=...` inspects the current case memory.
- `POST /api/model-extract` runs the optional vision extraction adapter.

When `ANTHROPIC_API_KEY` is configured, the agent runs a bounded LangGraph workflow. LangChain defines the model messages and typed tools; LangGraph orchestrates the `agent → tools → agent → final` state loop with a four-iteration limit and case-scoped checkpoint memory. Without a key, the same front-end contract uses a clearly labeled deterministic fallback.

The current harness intentionally does not use RAG or a vector database. Candidate documents come only from the selected thread or explicitly supplied local context; deterministic comparison and bounded case memory keep the evidence scope inspectable.

## What is real vs. stubbed

Real in this slice:

- PDF page rendering with `pdf.js` for both sample-thread documents and user uploads.
- Digital PDF text extraction.
- Browser OCR fallback with Tesseract.js/WASM.
- Deterministic field parsing and total arithmetic checks.
- Parallel model adapter and field-level reconciliation.
- Duplicate scoring using vendor, invoice number, amount, PO, dates, and service periods.
- Local action state and review-note copy.
- A centered conversational agent workspace with case-scoped prompts and selected PDF context.
- Local agent APIs for inbox, capabilities, tool traces, review decisions, and case memory.
- Deterministic tool executors separated under `server/tools/`, with a central allowlist and dispatcher.
- Input/output validation for agent and model requests, including tool allowlisting and bounded document context.
- LangChain tools and LangGraph state orchestration with a deterministic fallback when no model key is present.
- Draft-only supplier reply tool with configurable analyst signature.
- A reproducible ten-case corpus evaluation through `npm run eval`.

Stubbed or deliberately omitted:

- ERP/AP ledger integration.
- A live Gmail, Outlook, or IMAP inbox connector; `samples/inbox/` is the transparent local stub.
- External email sending; the reply capability only creates a draft and requires human action outside the harness.
- Actual payment blocking or approval.
- Persistent database and user authentication.
- Production-grade invoice classification for every supplier layout.

The deterministic fallback is intentionally visible when no API key exists. It allows reviewers to inspect the full harness without a secret, while the LangChain/LangGraph adapter provides the real bounded planning path and the Anthropic adapter provides vision extraction. The selected sample PDF is parsed locally before the agent receives its bounded context.

## Design notes

See [`DESIGN.md`](DESIGN.md) for the problem thesis, harness architecture, failure handling, evaluation approach, and tradeoffs.
