import { buildDuplicatePairs, createSummary, getDemoDocuments, reconcileExtractions } from '../src/lib/invoiceEngine.js';
import { inboxFixtures } from '../src/lib/inboxFixtures.js';

const reviewMemory = new Map();

function preparedDocuments() {
  return getDemoDocuments().map((document) => ({
    ...document,
    reconciled: reconcileExtractions(document.deterministic, document.model)
  }));
}

export function getAgentCapabilities() {
  return [
    { name: 'scan_inbox', description: 'Read the selected local inbox thread and its attachment metadata.', mode: 'read-only' },
    { name: 'extract_invoice', description: 'Extract invoice fields through deterministic rules and optional vision.', mode: 'read-only' },
    { name: 'find_similar_invoices', description: 'Compare the invoice against known reference documents.', mode: 'read-only' },
    { name: 'compare_documents', description: 'Explain agreeing and conflicting fields with evidence.', mode: 'read-only' },
    { name: 'draft_vendor_message', description: 'Prepare a clarification message without sending it.', mode: 'draft-only' },
    { name: 'save_review_decision', description: 'Save the analyst decision in the current local session.', mode: 'human-confirmed' }
  ];
}

function tool(name, input, result) {
  return { name, input, result };
}

function draftFor(thread, summary) {
  return `Subject: Clarification needed for ${thread.subject}\n\nHi ${thread.senderShort} team,\n\nWe are reviewing the invoice referenced in your message. Could you confirm whether this is a resend of an invoice already submitted, or provide the intended correction? We have identified ${summary.signals.length ? summary.signals.join(', ').toLowerCase() : 'a possible overlap with an existing invoice'} as the reason for the review.\n\nThank you,\nAccounts Payable`;
}

export function runAgentTurn({ threadId, message = '' }) {
  const thread = inboxFixtures.find((item) => item.id === threadId) || inboxFixtures[0];
  const documents = preparedDocuments();
  const pairs = buildDuplicatePairs(documents);
  const pair = thread.pairId ? pairs.find((item) => item.id === thread.pairId) : null;
  const summary = createSummary(pair ? [pair] : [], documents);
  const lower = message.toLowerCase();
  const toolCalls = [
    tool('scan_inbox', { threadId }, `Read ${thread.sender} / ${thread.subject}`),
    tool('extract_invoice', { attachments: thread.attachments }, 'Used deterministic fields and local sample context')
  ];
  let assistantMessage = thread.agentMessage;
  let draft = null;

  if (lower.includes('why') || lower.includes('flag') || lower.includes('marc')) {
    toolCalls.push(tool('find_similar_invoices', { threadId }, pair ? `${Math.round(pair.score * 100)}% match score` : 'No matching reference pair'));
    toolCalls.push(tool('compare_documents', { pairId: pair?.id || null }, pair ? summary.signals : ['No duplicate signals']));
    assistantMessage = pair
      ? `I flagged this thread because ${summary.signals.join(', ').toLowerCase()}. The evidence points to a ${summary.label.toLowerCase()} rather than a final accounting decision.`
      : 'I did not find a linked reference pair in this local sample. The thread remains visible because the email itself signals a correction, missing context, or low extraction confidence.';
  } else if (lower.includes('evidence') || lower.includes('compare')) {
    toolCalls.push(tool('compare_documents', { pairId: pair?.id || null }, pair ? { signals: summary.signals, confidence: Math.round(summary.score * 100) } : { signals: [], confidence: 0 }));
    assistantMessage = pair
      ? `The strongest evidence is ${summary.signals.join(', ').toLowerCase()}. I would keep the case with a human analyst because similar invoices can represent recurring charges or corrected versions.`
      : 'The current thread has no second invoice in the local reference set. I would request the missing document or PO before clearing it.';
  } else if (lower.includes('draft') || lower.includes('reply') || lower.includes('correo')) {
    toolCalls.push(tool('draft_vendor_message', { threadId }, 'Created a draft only; nothing was sent'));
    draft = draftFor(thread, summary);
    assistantMessage = 'I prepared a clarification draft. It is not sent automatically and still needs analyst review.';
  } else {
    toolCalls.push(tool('find_similar_invoices', { threadId }, pair ? `${Math.round(pair.score * 100)}% match score` : 'No matching reference pair'));
  }

  const turn = { threadId, message, assistantMessage, draft, summary, toolCalls, guardrails: ['Evidence required for classifications', 'No payment or outbound-email action', 'Human confirmation remains required'] };
  const history = reviewMemory.get(threadId) || [];
  reviewMemory.set(threadId, [...history, turn].slice(-8));
  return { ...turn, memory: { threadId, turns: reviewMemory.get(threadId).length, scope: 'case-scoped local session' } };
}

export function saveReviewDecision({ threadId, action }) {
  const history = reviewMemory.get(threadId) || [];
  const decision = { threadId, action, savedAt: new Date().toISOString() };
  reviewMemory.set(threadId, [...history, { type: 'decision', ...decision }].slice(-8));
  return { ...decision, memory: { threadId, turns: reviewMemory.get(threadId).length, scope: 'case-scoped local session' } };
}

export function getReviewMemory(threadId) {
  return { threadId, entries: reviewMemory.get(threadId) || [], scope: 'case-scoped local session' };
}
