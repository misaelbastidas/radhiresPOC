import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_AGENT_DOCUMENTS, MAX_DOCUMENT_PAGES, MAX_DOCUMENT_TEXT, validateSelectedInvoiceFiles } from '../src/lib/agentPolicy.js';
import { validateAgentInput, validateModelInput } from '../server/harnessValidation.mjs';

const pdf = (name) => ({ name, size: 1024 });
const metadata = (name = 'invoice.pdf') => ({ name, text: 'Invoice number: A-100', pages: [{ page: 1, text: 'Invoice number: A-100' }] });

test('client document policy accepts exactly the bounded context size', () => {
  const result = validateSelectedInvoiceFiles(Array.from({ length: MAX_AGENT_DOCUMENTS }, (_, index) => pdf(`invoice-${index + 1}.pdf`)));
  assert.equal(result.ok, true);
  assert.equal(result.value.length, MAX_AGENT_DOCUMENTS);
});

test('client document policy rejects non-PDF files and oversized selections before extraction', () => {
  assert.equal(validateSelectedInvoiceFiles([pdf('invoice.pdf'), pdf('notes.txt')]).ok, false);
  const result = validateSelectedInvoiceFiles(Array.from({ length: MAX_AGENT_DOCUMENTS + 1 }, (_, index) => pdf(`invoice-${index + 1}.pdf`)));
  assert.equal(result.ok, false);
  assert.match(result.error, /at most 4 PDFs/i);
});

test('agent input guardrail accepts four documents and rejects the fifth', () => {
  const accepted = validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: Array.from({ length: MAX_AGENT_DOCUMENTS }, (_, index) => metadata(`invoice-${index + 1}.pdf`)) });
  assert.equal(accepted.ok, true);
  const rejected = validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: Array.from({ length: MAX_AGENT_DOCUMENTS + 1 }, (_, index) => metadata(`invoice-${index + 1}.pdf`)) });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /At most 4 documents/i);
  assert.equal(validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: [] }).ok, false);
});

test('document limits reject oversized text and page packs at both input boundaries', () => {
  assert.equal(validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: [{ ...metadata(), text: 'x'.repeat(MAX_DOCUMENT_TEXT + 1) }] }).ok, false);
  assert.equal(validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: [{ ...metadata(), pages: Array.from({ length: MAX_DOCUMENT_PAGES + 1 }, (_, index) => ({ page: index + 1, text: 'x' })) }] }).ok, false);
  assert.equal(validateModelInput({ documentName: 'invoice.pdf', pages: Array.from({ length: MAX_DOCUMENT_PAGES + 1 }, () => ({ page: 1 })) }).ok, false);
  assert.equal(validateModelInput({ documentName: 'invoice.pdf', text: 'x'.repeat(MAX_DOCUMENT_TEXT + 1) }).ok, false);
});

test('model input rejects missing content and non-PDF names', () => {
  assert.equal(validateModelInput({ documentName: 'notes.txt', text: 'Invoice' }).ok, false);
  assert.equal(validateModelInput({ documentName: 'invoice.pdf' }).ok, false);
});
