import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { parseInvoiceFields, scoreDuplicate, valueOf } from '../src/lib/invoiceEngine.js';

const samplesRoot = path.resolve('samples/autoparts');
const fixturesRoot = path.resolve('fixtures/autoparts');
const manifest = JSON.parse(await readFile(path.join(samplesRoot, 'manifest.json'), 'utf8'));

async function fieldsFor(fileName) {
  const text = await readFile(path.join(fixturesRoot, fileName), 'utf8');
  return parseInvoiceFields(text);
}

test('automotive-parts corpus is complete and editable', async () => {
  assert.equal(manifest.cases.length, 10);
  for (const sampleCase of manifest.cases) {
    assert.ok(sampleCase.expected);
    assert.ok(sampleCase.pdfDocuments?.length, `${sampleCase.id} should point to generated PDFs`);
    for (const fileName of sampleCase.sourceDocuments) {
      const fields = await fieldsFor(fileName);
      assert.ok(valueOf(fields, 'vendorName'), `${fileName} should contain a vendor`);
      assert.notEqual(valueOf(fields, 'total'), null, `${fileName} should contain a total`);
    }
    for (const pdfName of sampleCase.pdfDocuments) {
      const pdf = await stat(path.join(samplesRoot, pdfName));
      assert.ok(pdf.size > 1000, `${pdfName} should be a generated PDF`);
    }
  }
});

test('corpus expectations exercise duplicate, recurrence, and review outcomes', async () => {
  const exact = scoreDuplicate(await fieldsFor('auto-1042-original.txt'), await fieldsFor('auto-1042-resubmitted.txt'));
  const recurring = scoreDuplicate(await fieldsFor('auto-1042-original.txt'), await fieldsFor('auto-1043-recurring.txt'));
  const corrected = scoreDuplicate(await fieldsFor('torque-8811-original.txt'), await fieldsFor('torque-8812-corrected.txt'));
  const changed = scoreDuplicate(await fieldsFor('axle-5520-original.txt'), await fieldsFor('axle-5520-revised.txt'));
  const monthly = scoreDuplicate(await fieldsFor('boreal-031-march.txt'), await fieldsFor('boreal-032-april.txt'));

  assert.equal(exact.classification, 'likely-duplicate');
  assert.equal(recurring.classification, 'legitimate-recurring');
  assert.equal(corrected.classification, 'needs-review');
  assert.equal(changed.classification, 'needs-review');
  assert.equal(monthly.classification, 'legitimate-recurring');
});

test('corpus preserves the distinction between credit memo and invoice context', async () => {
  const creditMemo = await readFile(path.join(fixturesRoot, 'garage-204-credit-memo.txt'), 'utf8');
  assert.match(creditMemo, /Document type: Credit memo/);
  assert.match(creditMemo, /Invoice reference: GP-7710/);
  assert.equal(valueOf(await fieldsFor('garage-204-credit-memo.txt'), 'invoiceNumber'), null);
});
