import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const distDir = path.join(__dirname, 'dist');

const invoiceSchema = {
  vendorName: null,
  vendorTaxId: null,
  invoiceNumber: null,
  invoiceDate: null,
  purchaseOrder: null,
  currency: null,
  subtotal: null,
  tax: null,
  total: null,
  servicePeriod: null,
  paymentTerms: null,
  lineItems: [],
  evidence: [],
  warnings: []
};

const extractionPrompt = `You are extracting fields from a supplier invoice for an accounts-payable duplicate review.

Return only valid JSON. Do not infer values that are not visible. Use null for missing or ambiguous scalar values and [] for missing line items.
Every field that you do extract must include a short verbatim evidence quote and page number in the evidence array.
Dates must use ISO format YYYY-MM-DD when possible. Amounts must be numbers without currency symbols.
This is document understanding only: do not decide whether to pay or reject the invoice.

Return this shape:
{
  "vendorName": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "vendorTaxId": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "invoiceNumber": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "invoiceDate": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "purchaseOrder": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "currency": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "subtotal": {"value": number|null, "confidence": number, "page": number|null, "evidence": string|null},
  "tax": {"value": number|null, "confidence": number, "page": number|null, "evidence": string|null},
  "total": {"value": number|null, "confidence": number, "page": number|null, "evidence": string|null},
  "servicePeriod": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "paymentTerms": {"value": string|null, "confidence": number, "page": number|null, "evidence": string|null},
  "lineItems": [{"description": string, "quantity": number|null, "unitPrice": number|null, "amount": number|null, "page": number|null, "evidence": string|null}],
  "warnings": string[]
}`;

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text, contentType = 'text/plain; charset=utf-8') {
  response.writeHead(status, { 'content-type': contentType });
  response.end(text);
}

async function readBody(request, maxBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maxBytes) throw new Error('Request is too large. Keep the document pack under 32 MB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseJsonFromText(text) {
  const withoutFence = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(withoutFence.slice(start, end + 1));
    throw new Error('The model returned a non-JSON response.');
  }
}

function normalizeModelResult(result) {
  const output = { ...invoiceSchema, ...result };
  const scalarFields = Object.keys(invoiceSchema).filter((key) => !['lineItems', 'evidence', 'warnings'].includes(key));
  for (const field of scalarFields) {
    const value = output[field];
    if (value && typeof value === 'object' && 'value' in value) continue;
    output[field] = { value: value ?? null, confidence: value == null ? 0 : 0.5, page: null, evidence: null };
  }
  output.lineItems = Array.isArray(output.lineItems) ? output.lineItems : [];
  output.warnings = Array.isArray(output.warnings) ? output.warnings : [];
  return output;
}

function demoModelResult(deterministicFields = {}) {
  const valueOf = (field) => {
    const raw = deterministicFields[field];
    return raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw ?? null;
  };
  const fields = {};
  for (const key of ['vendorName', 'vendorTaxId', 'invoiceNumber', 'invoiceDate', 'purchaseOrder', 'currency', 'subtotal', 'tax', 'total', 'servicePeriod', 'paymentTerms']) {
    fields[key] = {
      value: valueOf(key),
      confidence: valueOf(key) == null ? 0 : 0.76,
      page: valueOf(key) == null ? null : 1,
      evidence: valueOf(key) == null ? null : 'Demo model adapter - connect Anthropic to replace this result.'
    };
  }
  fields.lineItems = [];
  fields.warnings = ['No ANTHROPIC_API_KEY configured. This is a clearly labeled demo-model response.'];
  return fields;
}

async function extractWithClaude(payload) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { provider: 'demo-model', model: null, result: demoModelResult(payload.deterministicFields) };
  }

  const images = (payload.pages || []).slice(0, 6).map((page) => {
    const match = String(page.imageDataUrl || '').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return {
      type: 'image',
      source: { type: 'base64', media_type: match[1], data: match[2] }
    };
  }).filter(Boolean);

  const textContext = payload.text ? `\nDeterministic text layer for cross-checking:\n${String(payload.text).slice(0, 18000)}` : '';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2400,
      temperature: 0,
      system: extractionPrompt,
      messages: [{
        role: 'user',
        content: [
          ...images,
          { type: 'text', text: `Document name: ${payload.documentName || 'invoice.pdf'}\nAnalyze all supplied pages and return the requested JSON.${textContext}` }
        ]
      }]
    })
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error?.message || `Anthropic request failed with status ${response.status}.`);
  }
  const text = (body.content || []).filter((item) => item.type === 'text').map((item) => item.text).join('\n');
  return {
    provider: 'anthropic',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
    result: normalizeModelResult(parseJsonFromText(text))
  };
}

async function serveStatic(request, response, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const candidate = path.normalize(path.join(distDir, safePath));
  if (!candidate.startsWith(distDir)) return sendText(response, 403, 'Forbidden');
  try {
    const file = await fs.readFile(candidate);
    const extension = path.extname(candidate).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.json': 'application/json; charset=utf-8',
      '.pdf': 'application/pdf'
    };
    response.writeHead(200, { 'content-type': types[extension] || 'application/octet-stream' });
    response.end(file);
  } catch {
    try {
      const fallback = await fs.readFile(path.join(distDir, 'index.html'));
      sendText(response, 200, fallback, 'text/html; charset=utf-8');
    } catch {
      sendText(response, 404, 'Run npm run build before npm start.');
    }
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname === '/api/health') {
      return sendJson(response, 200, {
        ok: true,
        modelConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
        model: process.env.ANTHROPIC_MODEL || null
      });
    }

    if (url.pathname === '/api/model-extract' && request.method === 'POST') {
      const payload = JSON.parse(await readBody(request));
      if ((!Array.isArray(payload.pages) || payload.pages.length === 0) && !payload.text) {
        return sendJson(response, 400, { error: 'At least one rendered page is required.' });
      }
      const extraction = await extractWithClaude(payload);
      return sendJson(response, 200, extraction);
    }

    if (request.method === 'GET') return serveStatic(request, response, url.pathname);
    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    return sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unexpected server error.' });
  }
});

server.listen(port, () => {
  console.log(`Ledgerline API and app server listening on http://localhost:${port}`);
  console.log(process.env.ANTHROPIC_API_KEY ? 'Vision model: configured' : 'Vision model: demo adapter (set ANTHROPIC_API_KEY for live extraction)');
});
