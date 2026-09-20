import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentCapabilities, getReviewMemory, runAgentTurn, saveReviewDecision } from '../server/agentEngine.mjs';

test('exposes an allowlisted set of agent capabilities', () => {
  const capabilities = getAgentCapabilities();
  assert.deepEqual(capabilities.map((capability) => capability.name), [
    'scan_inbox',
    'extract_invoice',
    'find_similar_invoices',
    'compare_documents',
    'draft_vendor_message',
    'save_review_decision'
  ]);
});

test('runs a case-scoped evidence turn with tool traces', () => {
  const result = runAgentTurn({ threadId: 'mail-01', message: 'Why was this flagged?' });
  assert.equal(result.threadId, 'mail-01');
  assert.equal(result.summary.classification, 'likely-duplicate');
  assert.ok(result.toolCalls.some((call) => call.name === 'compare_documents'));
  assert.ok(result.guardrails.includes('Human confirmation remains required'));
});

test('drafts without sending and records a human decision in memory', () => {
  const draft = runAgentTurn({ threadId: 'mail-04', message: 'Draft a vendor reply' });
  assert.match(draft.draft, /Subject: Clarification/);
  assert.ok(draft.toolCalls.some((call) => call.name === 'draft_vendor_message'));
  const saved = saveReviewDecision({ threadId: 'mail-04', action: 'Request vendor confirmation' });
  assert.equal(saved.action, 'Request vendor confirmation');
  assert.ok(getReviewMemory('mail-04').entries.some((entry) => entry.type === 'decision'));
});
