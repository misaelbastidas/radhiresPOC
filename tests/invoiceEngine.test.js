import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDuplicatePairs, getDemoDocuments, parseInvoiceFields, reconcileExtractions, scoreDuplicate, valueOf } from '../src/lib/invoiceEngine.js';

test('parses the editable invoice fixture shape', () => {
  const fields = parseInvoiceFields(`Vendor: AutoMotion Parts\nInvoice number: AM-2026-1042\nInvoice date: 2026-02-12\nPurchase order: PO-8841\nService period: Jan 2026\nSubtotal: 1,260.00\nTax: 240.00\nTotal due: 1,500.00`);
  assert.equal(valueOf(fields, 'vendorName'), 'AutoMotion Parts');
  assert.equal(valueOf(fields, 'invoiceNumber'), 'AM-2026-1042');
  assert.equal(valueOf(fields, 'purchaseOrder'), 'PO-8841');
  assert.equal(valueOf(fields, 'total'), 1500);
  assert.equal(fields.warnings.length, 0);
});

test('flags a resubmission with strong duplicate signals', () => {
  const [first, second] = getDemoDocuments();
  const result = scoreDuplicate(first.deterministic, second.deterministic);
  assert.equal(result.classification, 'likely-duplicate');
  assert.ok(result.score >= 0.72);
  assert.ok(result.signals.includes('Same invoice number'));
});

test('does not treat a different service period as the same recurring charge', () => {
  const docs = getDemoDocuments();
  const result = scoreDuplicate(docs[0].deterministic, docs[2].deterministic);
  assert.equal(result.classification, 'legitimate-recurring');
  assert.equal(result.recurring, true);
});

test('reconciliation exposes conflicts instead of silently selecting a value', () => {
  const deterministic = parseInvoiceFields('Vendor: Example\nInvoice number: EX-1\nTotal due: 100.00');
  const model = { invoiceNumber: { value: 'EX-2', confidence: 0.86, evidence: 'Invoice # EX-2' }, total: { value: 110, confidence: 0.8, evidence: 'Total 110.00' } };
  const result = reconcileExtractions(deterministic, model);
  assert.equal(result.invoiceNumber.status, 'conflict');
  assert.equal(result.total.status, 'conflict');
  assert.ok(result.warnings.length >= 2);
});

test('does not mistake a missing purchase order warning for a purchase order value', () => {
  const fields = parseInvoiceFields('Vendor: Ruta Norte Logistics\nWarning: Purchase order was not included in the supplier document.');
  assert.equal(valueOf(fields, 'purchaseOrder'), null);
});

test('keeps credit memos outside payable duplicate classification', () => {
  const invoice = parseInvoiceFields('Vendor: GaragePro\nInvoice number: GP-7710\nTotal due: 1299.20');
  const creditMemo = parseInvoiceFields('Vendor: GaragePro\nCredit memo number: CM-204\nTotal due: -324.80\nDocument type: Credit memo');
  const result = scoreDuplicate(invoice, creditMemo);
  assert.equal(result.classification, 'not-duplicate');
  assert.equal(result.creditMemo, true);
});

test('builds pair queue ordered by risk', () => {
  const pairs = buildDuplicatePairs(getDemoDocuments());
  assert.equal(pairs.length, 10);
  assert.equal(pairs[0].classification, 'likely-duplicate');
  assert.ok(pairs[0].score > pairs[1].score);
});
