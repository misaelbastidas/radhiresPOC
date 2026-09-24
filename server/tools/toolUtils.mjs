import { valueOf } from '../../src/lib/invoiceEngine.js';

export function documentSubset(documents, ids) {
  if (!Array.isArray(ids) || !ids.length) return documents;
  const allowed = new Set(ids);
  return documents.filter((document) => allowed.has(document.id));
}

export function pairFromInput(pairs, input = {}) {
  if (input.firstId && input.secondId) {
    return pairs.find((pair) => pair.firstId === input.firstId && pair.secondId === input.secondId) || null;
  }
  return pairs[0] || null;
}

export function compactFields(extraction = {}) {
  const fields = {};
  for (const key of ['vendorName', 'vendorTaxId', 'invoiceNumber', 'invoiceDate', 'purchaseOrder', 'currency', 'subtotal', 'tax', 'total', 'servicePeriod', 'paymentTerms']) {
    const entry = extraction[key];
    const value = valueOf(extraction, key);
    if (value != null && value !== '') fields[key] = { value, confidence: entry?.confidence ?? null, evidence: entry?.evidence ?? null };
  }
  if (extraction.documentType) fields.documentType = extraction.documentType;
  if (Array.isArray(extraction.warnings) && extraction.warnings.length) fields.warnings = extraction.warnings.slice(0, 6);
  return fields;
}

export function createVendorDraft(thread, summary, documents) {
  const document = documents[0];
  const fields = document?.reconciled || document?.deterministic || {};
  const invoiceNumber = valueOf(fields, 'invoiceNumber') || 'the referenced invoice';
  const vendor = valueOf(fields, 'vendorName') || thread.senderShort || thread.sender;
  const signals = summary.signals.length ? summary.signals.join(', ').toLowerCase() : 'an incomplete comparison or missing supporting evidence';
  const fromName = process.env.REPLY_FROM_NAME || 'Accounts Payable';
  const subject = `Re: ${thread.subject}`;
  const body = `Hi ${vendor} team,\n\nWe are reviewing ${invoiceNumber} and need your confirmation before we continue processing it. Our review identified ${signals}.\n\nCould you please confirm whether this document is a resend, a correction that supersedes an earlier invoice, or a separate charge? If it is a correction, please confirm which invoice should remain active in your records.\n\nThank you,\n${fromName}`;
  return {
    to: thread.senderEmail || thread.sender,
    subject,
    body,
    fromName,
    status: 'draft-only',
    sent: false
  };
}
