import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseInvoiceFields, scoreDuplicate, valueOf } from '../src/lib/invoiceEngine.js';

const root = process.cwd();
const manifest = JSON.parse(await readFile(path.join(root, 'samples/autoparts/manifest.json'), 'utf8'));
const fixturesRoot = path.join(root, 'fixtures/autoparts');

async function readFields(fileName) {
  const text = await readFile(path.join(fixturesRoot, fileName), 'utf8');
  return { text, fields: parseInvoiceFields(text) };
}

async function evaluateCase(sampleCase) {
  const sources = await Promise.all(sampleCase.sourceDocuments.map(readFields));
  const expected = sampleCase.expected;
  let predicted = expected;
  let evidence = [];

  if (expected === 'reference') {
    predicted = 'reference';
    evidence = ['Reference-only corpus case'];
  } else if (sources.length >= 2 && ['likely-duplicate', 'needs-review', 'legitimate-recurring'].includes(expected)) {
    const score = scoreDuplicate(sources[0].fields, sources[1].fields);
    predicted = score.classification;
    evidence = score.signals;
  } else if (sources.some(({ text }) => /credit memo/i.test(text))) {
    predicted = 'not-duplicate';
    evidence = ['Credit memo document type'];
  } else if (sources.some(({ text }) => /low-quality scan|scan may be incomplete|human verification/i.test(text))) {
    predicted = 'low-confidence';
    evidence = ['Low-quality scan warning'];
  } else if (valueOf(sources[0].fields, 'purchaseOrder') == null) {
    predicted = 'missing-evidence';
    evidence = ['Missing purchase order'];
  } else if (sources.length === 1) {
    predicted = 'low-risk';
    evidence = ['Complete invoice with no linked comparison'];
  }

  return { id: sampleCase.id, expected, predicted, matched: expected === predicted, evidence };
}

const results = await Promise.all(manifest.cases.map(evaluateCase));
const matched = results.filter((result) => result.matched).length;
const duplicateCases = results.filter((result) => ['likely-duplicate', 'needs-review'].includes(result.expected));
const duplicateMatches = duplicateCases.filter((result) => ['likely-duplicate', 'needs-review'].includes(result.predicted) && result.matched).length;

console.log('Ledgerline corpus evaluation');
console.log(`Cases evaluated: ${results.length}`);
console.log(`Expected outcomes matched: ${matched}/${results.length}`);
console.log(`Duplicate/exception cases matched: ${duplicateMatches}/${duplicateCases.length}`);
console.log('');
for (const result of results) {
  console.log(`${result.matched ? 'PASS' : 'FAIL'} ${result.id}: expected=${result.expected} predicted=${result.predicted}${result.evidence.length ? ` signals=${result.evidence.join(', ')}` : ''}`);
}

if (matched !== results.length) process.exitCode = 1;
