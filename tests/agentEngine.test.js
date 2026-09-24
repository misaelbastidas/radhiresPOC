import test from 'node:test';
import assert from 'node:assert/strict';
import { getAgentCapabilities, getHarnessContract, getReviewMemory, runDeterministicFallbackTurn, runAgentTurnWithModel, saveReviewDecision } from '../server/agentEngine.mjs';
import { validateAgentInput, validateAgentOutput } from '../server/harnessValidation.mjs';
import { AIMessage } from '@langchain/core/messages';
import { runLangGraphAgent } from '../server/langgraphAgent.mjs';

test('exposes an allowlisted set of agent capabilities', () => {
  const capabilities = getAgentCapabilities();
  assert.deepEqual(capabilities.map((capability) => capability.name), [
    'scan_inbox',
    'extract_invoice',
    'find_similar_invoices',
    'compare_documents',
    'validate_invoice_math',
    'draft_vendor_message',
    'save_review_decision'
  ]);
});

test('exposes the harness contract without mixing model tools and human confirmation', () => {
  const contract = getHarnessContract();
  assert.equal(contract.toolPolicy.modelAllowlistCount, 6);
  assert.equal(contract.toolPolicy.exposedCapabilityCount, 7);
  assert.deepEqual(contract.toolPolicy.modelAllowlist.map((tool) => tool.name), [
    'scan_inbox',
    'extract_invoice',
    'find_similar_invoices',
    'compare_documents',
    'validate_invoice_math',
    'draft_vendor_message'
  ]);
  assert.equal(contract.toolPolicy.humanConfirmedCapability.name, 'save_review_decision');
  assert.ok(contract.inputGuardrails.length > 0);
  assert.ok(contract.outputGuardrails.length > 0);
  assert.equal(contract.memoryManagement.key, 'thread_id / caseId');
});

test('runs a case-scoped evidence turn with tool traces', () => {
  const result = runDeterministicFallbackTurn({ threadId: 'mail-01', message: 'Why was this flagged?' });
  assert.equal(result.threadId, 'mail-01');
  assert.equal(result.summary.classification, 'likely-duplicate');
  assert.ok(result.toolCalls.some((call) => call.name === 'compare_documents'));
  assert.ok(result.guardrails.includes('Human confirmation remains required'));
});

test('classifies only when the analyst requests classification', () => {
  const result = runDeterministicFallbackTurn({ threadId: 'mail-01', message: 'Classify these invoices' });
  assert.equal(result.summary.classification, 'likely-duplicate');
  assert.ok(result.toolCalls.some((call) => call.name === 'find_similar_invoices'));
  assert.ok(result.toolCalls.some((call) => call.name === 'compare_documents'));
  assert.match(result.assistantMessage, /classified this case/i);
});

test('drafts without sending and records a human decision in memory', () => {
  const draft = runDeterministicFallbackTurn({ threadId: 'mail-04', message: 'Draft a vendor reply' });
  assert.match(draft.draft, /Subject: Re:/);
  const draftTool = draft.toolCalls.find((call) => call.name === 'draft_vendor_message');
  assert.ok(draftTool);
  assert.equal(draftTool.result.sent, false);
  assert.equal(draftTool.result.status, 'draft-only');
  const saved = saveReviewDecision({ threadId: 'mail-04', action: 'Request vendor confirmation' });
  assert.equal(saved.action, 'Request vendor confirmation');
  assert.ok(getReviewMemory('mail-04').entries.some((entry) => entry.type === 'decision'));
});

test('input and output guardrails reject unsafe or malformed agent payloads', () => {
  assert.equal(validateAgentInput({ threadId: 'mail-01', message: '' }).ok, false);
  assert.equal(validateAgentInput({ threadId: 'mail-01', message: 'Review', documents: [{ name: 'notes.txt' }] }).ok, false);
  const valid = runDeterministicFallbackTurn({ threadId: 'mail-01', message: 'Review this case' });
  assert.equal(validateAgentOutput(valid).ok, true);
  assert.equal(validateAgentOutput({ ...valid, toolCalls: [{ name: 'send_payment' }] }).ok, false);
});

test('model route has a safe deterministic fallback when no key is configured', async () => {
  const previousKey = process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  try {
    const result = await runAgentTurnWithModel({ threadId: 'mail-01', message: 'Classify these invoices' });
    assert.equal(result.agentMode, 'deterministic-fallback');
    assert.ok(result.guardrails.some((guardrail) => guardrail.includes('fallback')));
  } finally {
    if (previousKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = previousKey;
  }
});

test('LangGraph executes a typed LangChain tool and returns a traced agent turn offline', async () => {
  let calls = 0;
  const fakeModel = {
    async invoke() {
      calls += 1;
      if (calls === 1) {
        return new AIMessage({ content: '', tool_calls: [{ name: 'find_similar_invoices', args: {}, id: 'offline-tool-call-1', type: 'tool_call' }] });
      }
      return new AIMessage(JSON.stringify({
        assistantMessage: 'The deterministic comparison found strong duplicate evidence.',
        classification: 'likely-duplicate',
        confidence: 0.98,
        nextAction: 'hold_for_human_review',
        evidence: ['Same invoice number', 'Same total']
      }));
    }
  };
  const result = await runLangGraphAgent({ threadId: 'langgraph-offline-test', message: 'Classify these invoices' }, { modelOverride: fakeModel });
  assert.equal(result.agentMode, 'langgraph-tool-calling');
  assert.equal(calls, 2);
  assert.ok(result.toolCalls.some((call) => call.name === 'find_similar_invoices'));
  assert.equal(result.summary.classification, 'likely-duplicate');
  assert.ok(result.guardrails.some((guardrail) => guardrail.includes('LangGraph')));
});

test('separates rebuilt session context from prior review memory', async () => {
  const threadId = 'context-memory-separation-test';
  runDeterministicFallbackTurn({ threadId, message: 'Initial review memory event' });
  let prompt = '';
  const fakeModel = {
    async invoke(messages) {
      prompt = String(messages.at(-1)?.content || '');
      return new AIMessage(JSON.stringify({
        assistantMessage: 'The current session context was reviewed with prior case memory available.',
        classification: 'likely-duplicate',
        confidence: 0.9,
        nextAction: 'hold_for_human_review',
        evidence: ['Prior review memory was provided separately from the current PDFs.']
      }));
    }
  };
  await runLangGraphAgent({ threadId, message: 'Review this current session' }, { modelOverride: fakeModel });
  assert.match(prompt, /Selected session context/);
  assert.match(prompt, /recentCaseMemory/);
  assert.match(prompt, /Initial review memory event/);
});
