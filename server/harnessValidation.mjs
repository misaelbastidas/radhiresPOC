import { MAX_AGENT_DOCUMENTS, MAX_DOCUMENT_PAGES, MAX_DOCUMENT_TEXT } from '../src/lib/agentPolicy.js';

const allowedToolNames = new Set([
  'scan_inbox',
  'extract_invoice',
  'find_similar_invoices',
  'compare_documents',
  'validate_invoice_math',
  'draft_vendor_message',
  'save_review_decision'
]);

const allowedClassifications = new Set(['empty', 'likely-duplicate', 'needs-review', 'legitimate-recurring', 'not-duplicate']);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function validateAgentInput(payload) {
  if (!isPlainObject(payload)) return { ok: false, error: 'Agent input must be a JSON object.' };
  if (typeof payload.threadId !== 'string' || payload.threadId.length < 1 || payload.threadId.length > 100) {
    return { ok: false, error: 'threadId must be a short non-empty string.' };
  }
  if (typeof payload.message !== 'string' || payload.message.trim().length < 1 || payload.message.length > 500) {
    return { ok: false, error: 'message must contain between 1 and 500 characters.' };
  }
  if (payload.documents !== undefined) {
    if (!Array.isArray(payload.documents) || payload.documents.length === 0) {
      return { ok: false, error: 'At least one PDF document must be included when documents are provided.' };
    }
    if (payload.documents.length > MAX_AGENT_DOCUMENTS) {
      return { ok: false, error: `At most ${MAX_AGENT_DOCUMENTS} documents may be included in agent context.` };
    }
    for (const document of payload.documents) {
      if (!isPlainObject(document) || typeof document.name !== 'string' || !/\.pdf$/i.test(document.name)) {
        return { ok: false, error: 'Agent documents must be PDF metadata objects.' };
      }
      if (typeof document.text === 'string' && document.text.length > MAX_DOCUMENT_TEXT) {
        return { ok: false, error: 'Extracted document text is too large for the agent context.' };
      }
      if (Array.isArray(document.pages) && document.pages.length > MAX_DOCUMENT_PAGES) {
        return { ok: false, error: 'A document may contain at most six pages in agent context.' };
      }
    }
  }
  return { ok: true, value: { ...payload, message: payload.message.trim() } };
}

export function validateAgentOutput(output) {
  if (!isPlainObject(output) || typeof output.threadId !== 'string' || typeof output.assistantMessage !== 'string') {
    return { ok: false, error: 'Agent output is missing its core response fields.' };
  }
  if (!isPlainObject(output.summary) || !allowedClassifications.has(output.summary.classification)) {
    return { ok: false, error: 'Agent output contains an unknown classification.' };
  }
  if (!Array.isArray(output.toolCalls) || output.toolCalls.some((call) => !allowedToolNames.has(call?.name))) {
    return { ok: false, error: 'Agent output contains a tool outside the allowlist.' };
  }
  if (!Array.isArray(output.guardrails) || output.guardrails.length === 0) {
    return { ok: false, error: 'Agent output must include guardrail status.' };
  }
  return { ok: true, value: output };
}

export function validateModelInput(payload) {
  if (!isPlainObject(payload)) return { ok: false, error: 'Model input must be a JSON object.' };
  if (typeof payload.documentName !== 'string' || !/\.pdf$/i.test(payload.documentName)) {
    return { ok: false, error: 'documentName must identify a PDF.' };
  }
  const hasText = typeof payload.text === 'string' && payload.text.trim().length > 0;
  const hasPages = Array.isArray(payload.pages) && payload.pages.length > 0;
  if (!hasText && !hasPages) return { ok: false, error: 'At least one rendered page or text layer is required.' };
  if (hasPages && payload.pages.length > MAX_DOCUMENT_PAGES) return { ok: false, error: `A maximum of ${MAX_DOCUMENT_PAGES} PDF pages may be sent to the model.` };
  if (hasText && payload.text.length > MAX_DOCUMENT_TEXT) return { ok: false, error: 'The extracted text is too large for model extraction.' };
  return { ok: true, value: payload };
}
