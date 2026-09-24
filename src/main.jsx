import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildDuplicatePairs, createSummary, FIELD_LABELS, reconcileExtractions, valueOf } from './lib/invoiceEngine';
import { inboxFixtures, inboxSummary } from './lib/inboxFixtures';
import { MAX_AGENT_DOCUMENTS, validateSelectedInvoiceFiles } from './lib/agentPolicy';
import { extractPdfDocument, requestModelExtraction } from './lib/pdfPipeline';
import './styles.css';

const fieldOrder = ['vendorName', 'invoiceNumber', 'invoiceDate', 'purchaseOrder', 'servicePeriod', 'subtotal', 'tax', 'total'];

function finalizeDocuments(documents) {
  return documents.map((document) => ({
    ...document,
    reconciled: reconcileExtractions(document.deterministic || {}, document.model || {})
  }));
}

function money(value, currency = 'USD') {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
}

function compactMoney(value) {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value));
}

function agentContextDocuments(documents) {
  return documents.map((document) => ({
    id: document.id,
    name: document.name,
    source: document.source,
    extractionMethod: document.extractionMethod,
    text: document.text,
    pages: (document.pages || []).map(({ page, text, method }) => ({ page, text, method })),
    deterministic: document.deterministic,
    model: document.model,
    reconciled: document.reconciled
  }));
}

function valueLabel(document, key) {
  const value = valueOf(document?.reconciled || document?.deterministic, key);
  if (['subtotal', 'tax', 'total'].includes(key)) return value == null ? '—' : money(value, valueOf(document?.reconciled || document?.deterministic, 'currency') || 'USD');
  return value || '—';
}

function riskForDocument(documentId, pairs) {
  const relevant = pairs.filter((pair) => pair.firstId === documentId || pair.secondId === documentId);
  return relevant.sort((a, b) => b.score - a.score)[0] || null;
}

function StatusPill({ classification }) {
  const labels = {
    'likely-duplicate': ['Likely duplicate', 'danger'],
    'needs-review': ['Needs review', 'warning'],
    'legitimate-recurring': ['Likely recurring', 'success'],
    empty: ['No comparison', 'neutral']
  };
  const [label, tone] = labels[classification] || labels.empty;
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{label}</span>;
}

function ScoreRing({ score }) {
  const percentage = Math.round(score * 100);
  return <div className="score-ring" style={{ '--score': `${percentage * 3.6}deg` }}><span>{percentage}<small>%</small></span></div>;
}

function App() {
  const inputRef = useRef(null);
  const sampleDocumentCache = useRef(new Map());
  const [documents, setDocuments] = useState([]);
  const [selectedThreadId, setSelectedThreadId] = useState('mail-01');
  const [inboxThreads, setInboxThreads] = useState(inboxFixtures);
  const [actions, setActions] = useState({});
  const [processing, setProcessing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modelConfigured, setModelConfigured] = useState(false);
  const [agentActivity, setAgentActivity] = useState(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const workTokenRef = useRef(0);
  const agentRequestRef = useRef(0);

  const pairs = useMemo(() => buildDuplicatePairs(documents), [documents]);
  const inboxStats = inboxSummary(inboxThreads);
  const selectedThread = inboxThreads.find((thread) => thread.id === selectedThreadId) || inboxThreads[0];
  const currentActivity = agentActivity?.threadId === selectedThread?.id ? agentActivity : null;
  const activePair = currentActivity && selectedThread?.sampleFiles?.length > 1 ? pairs[0] || null : null;
  const summary = useMemo(() => currentActivity?.summary || createSummary([], documents), [currentActivity, documents]);
  const activeFirst = activePair ? documents.find((document) => document.id === activePair.firstId) : null;
  const activeSecond = activePair ? documents.find((document) => document.id === activePair.secondId) : null;
  const activeAction = activePair ? actions[activePair.id] : null;
  const workspaceBusy = agentBusy || Boolean(processing);

  const invalidateWork = () => {
    workTokenRef.current += 1;
    agentRequestRef.current += 1;
    return workTokenRef.current;
  };

  useEffect(() => {
    fetch('/api/health').then((response) => response.json()).then((body) => setModelConfigured(Boolean(body.modelConfigured))).catch(() => {});
    fetch('/api/inbox').then((response) => response.json()).then((body) => { if (Array.isArray(body.threads)) setInboxThreads(body.threads); }).catch(() => {});
  }, []);

  useEffect(() => {
    const thread = inboxThreads.find((item) => item.id === selectedThreadId);
    if (!thread?.sampleFiles?.length) return;
    loadSampleThread(thread).catch((error) => {
      setNotice({ tone: 'danger', text: error.message || 'The sample invoice could not be loaded.' });
    });
  }, [selectedThreadId, inboxThreads]);

  const loadSampleThread = async (thread) => {
    const workToken = invalidateWork();
    const cacheKey = thread.sampleFiles.join('|');
    const cached = sampleDocumentCache.current.get(cacheKey);
    if (cached) {
      setDocuments(cached);
      setProcessing(null);
      return cached;
    }

    setDocuments([]);
    setAgentActivity(null);
    setProcessing({ stage: 'Loading sample PDFs', progress: 0, detail: thread.subject });
    const next = [];
    const isCurrentWork = () => workTokenRef.current === workToken;
    try {
      for (const [index, fileName] of thread.sampleFiles.entries()) {
        if (!isCurrentWork()) return null;
        const response = await fetch(`/api/sample-file?name=${encodeURIComponent(fileName)}`);
        if (!response.ok) throw new Error(`Could not load sample PDF ${fileName}.`);
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: 'application/pdf' });
        const parsed = await extractPdfDocument(file, (progress) => {
          if (!isCurrentWork()) return;
          setProcessing({
            stage: progress.stage === 'ocr' ? 'OCR on device' : 'Reading PDF',
            progress: ((index + progress.progress) / thread.sampleFiles.length) * 85,
            detail: `${fileName} · page ${progress.page || 1} of ${progress.total || 1}`
          });
        });
        if (!isCurrentWork()) return null;
        setProcessing({ stage: 'Model extraction', progress: ((index + 0.9) / thread.sampleFiles.length) * 100, detail: `${fileName} · comparing extraction paths` });
        let model = {};
        try {
          const modelResponse = await requestModelExtraction(parsed, parsed.deterministic);
          model = modelResponse.result || {};
          setModelConfigured(modelResponse.provider === 'anthropic');
        } catch (error) {
          model = { warnings: [`Model route unavailable: ${error.message}`] };
        }
        next.push({ ...parsed, model });
      }
      if (!isCurrentWork()) return null;
      const finalized = finalizeDocuments(next);
      sampleDocumentCache.current.set(cacheKey, finalized);
      setDocuments(finalized);
      return finalized;
    } finally {
      if (isCurrentWork()) setProcessing(null);
    }
  };

  const loadDemo = () => {
    const thread = inboxThreads.find((item) => item.id === 'mail-01') || inboxThreads[0];
    setActions({});
    setSelectedThreadId('mail-01');
    setAgentActivity(null);
    if (thread) {
      loadSampleThread(thread).then(() => {
        setNotice({ tone: 'success', text: 'Loaded the sample inbox. Ask the agent to classify the selected PDFs.' });
        setTimeout(() => setNotice(null), 4200);
      }).catch((error) => setNotice({ tone: 'danger', text: error.message || 'The sample pack could not be loaded.' }));
    }
  };

  const processFiles = async (event) => {
    const selection = validateSelectedInvoiceFiles(event.target.files);
    const files = selection.value || [];
    if (!selection.ok) {
      setNotice({ tone: 'warning', text: selection.error });
      event.target.value = '';
      return;
    }
    if (!files.length) return;
    const workToken = invalidateWork();
    const isCurrentWork = () => workTokenRef.current === workToken;
    setDocuments([]);
    setAgentActivity(null);
    setProcessing({ stage: 'Starting', progress: 0, detail: 'Preparing local PDF extraction...' });
    setNotice(null);
    const next = [];
    try {
      for (const [index, file] of files.entries()) {
        if (!isCurrentWork()) return;
        const parsed = await extractPdfDocument(file, (progress) => {
          if (!isCurrentWork()) return;
          setProcessing({
            stage: progress.stage === 'ocr' ? 'OCR on device' : 'Reading PDF',
            progress: ((index + progress.progress) / files.length) * 100,
            detail: `${file.name} · page ${progress.page || 1} of ${progress.total || 1}`
          });
        });
        if (!isCurrentWork()) return;
        setProcessing({ stage: 'Model extraction', progress: ((index + 0.75) / files.length) * 100, detail: `${file.name} · comparing extraction paths` });
        let model = {};
        try {
          const response = await requestModelExtraction(parsed, parsed.deterministic);
          model = response.result || {};
          setModelConfigured(response.provider === 'anthropic');
        } catch (error) {
          model = { warnings: [`Model route unavailable: ${error.message}`] };
        }
        next.push({ ...parsed, model });
      }
      if (!isCurrentWork()) return;
      setDocuments(finalizeDocuments(next));
      setNotice({ tone: 'success', text: `Analyzed ${next.length} invoice${next.length === 1 ? '' : 's'} locally. Select a pair to review the evidence.` });
    } catch (error) {
      setNotice({ tone: 'danger', text: error.message || 'The PDF could not be processed.' });
    } finally {
      if (isCurrentWork()) setProcessing(null);
      event.target.value = '';
    }
  };

  const chooseAction = (action) => {
    if (!activePair) return;
    setActions((current) => ({ ...current, [activePair.id]: action }));
    fetch('/api/reviews', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: selectedThread?.id, action }) }).catch(() => {});
    setNotice({ tone: 'success', text: `Saved locally: ${action}. No payment or ERP action was taken.` });
    setTimeout(() => setNotice(null), 4200);
  };

  const askAgent = async (message, threadOverride = selectedThread, documentsOverride = documents) => {
    if (!threadOverride || workspaceBusy) return;
    const contextDocuments = agentContextDocuments(documentsOverride);
    if (!contextDocuments.length) {
      setNotice({ tone: 'warning', text: 'Wait until the selected invoice context finishes loading.' });
      return;
    }
    if (contextDocuments.length > MAX_AGENT_DOCUMENTS) {
      setNotice({ tone: 'warning', text: `Select at most ${MAX_AGENT_DOCUMENTS} PDFs before asking the agent to review them.` });
      return;
    }
    const requestId = ++agentRequestRef.current;
    setAgentBusy(true);
    setAgentActivity(null);
    try {
      const response = await fetch('/api/agent/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ threadId: threadOverride.id, message, documents: contextDocuments })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Agent request failed.');
      if (requestId === agentRequestRef.current) setAgentActivity(body);
    } catch (error) {
      setNotice({ tone: 'danger', text: error.message || 'The agent could not complete that turn.' });
    } finally {
      setAgentBusy(false);
    }
  };

  const copyReviewNote = async () => {
    if (!activePair) return;
    const text = `Invoice exception review\n${activeFirst.name} vs ${activeSecond.name}\nStatus: ${summary.label}\nConfidence: ${Math.round(summary.score * 100)}%\nSignals: ${summary.signals.join(', ')}\nSuggested next step: ${activeAction || 'Request vendor confirmation'}`;
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ tone: 'success', text: 'Review note copied to clipboard.' });
      setTimeout(() => setNotice(null), 3000);
    } catch {
      setNotice({ tone: 'warning', text: 'Clipboard access is unavailable in this browser.' });
    }
  };

  const copyDraft = async (draft) => {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setNotice({ tone: 'success', text: 'Reply draft copied to clipboard. Nothing was sent.' });
      setTimeout(() => setNotice(null), 3000);
    } catch {
      setNotice({ tone: 'warning', text: 'Clipboard access is unavailable in this browser.' });
    }
  };

  return (
    <div className="app-shell agent-app">
      <main className="main-canvas agent-main">
        <header className="topbar agent-topbar">
          <div className="brand-lockup compact-brand"><div className="brand-mark"><span /><span /><span /></div><div><div className="brand-name">Ledgerline</div><div className="brand-subtitle">Invoice assistant</div></div></div>
          <div className="workspace-status"><span className="live-dot" />Local demo</div>
        </header>

        <div className="chat-page">
          {notice && <div className={`notice ${notice.tone}`}><span>{notice.tone === 'success' ? '✓' : '!'}</span>{notice.text}</div>}
          {processing && <div className="processing-banner"><div className="spinner" /><div><strong>{processing.stage}</strong><span>{processing.detail}</span></div><div className="progress-track"><span style={{ width: `${Math.max(4, processing.progress)}%` }} /></div><span className="processing-percent">{Math.round(processing.progress)}%</span></div>}

          <section className="chat-hero"><div className="eyebrow">Human-in-the-loop invoice assistant</div><h1>{currentActivity ? 'Let’s review the case.' : 'What would you like to review?'}</h1><p>Ask Ledgerline to classify invoices, compare evidence, validate totals, or draft a supplier reply.</p></section>

          <div className="context-bar">
            <div className="context-copy"><span className="context-icon">⌁</span><div><span className="context-label">Case context</span><strong>{selectedThread?.senderShort || 'No sample case'}</strong></div><span className="context-count">{documents.length} PDF{documents.length === 1 ? '' : 's'} loaded</span></div>
            <select className="case-select" aria-label="Choose sample case" value={selectedThreadId} disabled={agentBusy} onChange={(event) => { invalidateWork(); setSelectedThreadId(event.target.value); setDocuments([]); setAgentActivity(null); setProcessing(null); }}><option value="mail-01">AutoMotion sample</option>{inboxThreads.filter((thread) => thread.id !== 'mail-01').map((thread) => <option key={thread.id} value={thread.id}>{thread.senderShort} · {thread.tag}</option>)}</select>
            <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={processFiles} />
            <button className="context-upload" disabled={workspaceBusy} onClick={() => inputRef.current?.click()}>＋ Attach PDFs</button>
          </div>

          <AgentConsole thread={selectedThread} summary={summary} activeFirst={activeFirst} activeSecond={activeSecond} activeAction={activeAction} activity={agentActivity} busy={workspaceBusy} onPrompt={askAgent} onCopyDraft={copyDraft} onChooseAction={chooseAction} onCopyReviewNote={copyReviewNote} />
          <div className="chat-footer-note"><span>Human approval required</span><span>·</span><span>Nothing is sent automatically</span></div>
        </div>
      </main>
    </div>
  );
}

function DocumentCard({ document, label }) {
  const type = document.name?.toLowerCase().endsWith('.txt') || document.name?.toLowerCase().endsWith('.md') ? 'TXT' : 'PDF';
  return <div className="document-card"><div className="document-card-head"><span className="document-label">{label}</span><span className="file-type">{type}</span></div><div className="document-name"><span className="pdf-icon">▤</span><span>{document.name}</span></div><div className="document-stats"><span>{document.pages?.length || 1} page{document.pages?.length === 1 ? '' : 's'}</span><span>•</span><span>{document.extractionMethod || 'sample'}</span></div><div className="doc-total"><span>Reported total</span><strong>{money(valueOf(document.reconciled || document.deterministic, 'total'))}</strong></div></div>;
}

function AgentConsole({ thread, summary, activeFirst, activeSecond, activeAction, activity, busy, onPrompt, onCopyDraft, onChooseAction, onCopyReviewNote }) {
  const [draft, setDraft] = useState('');
  const currentActivity = activity?.threadId === thread?.id ? activity : null;
  const hasCaseResult = currentActivity && activeFirst && activeSecond;
  const submitPrompt = (event) => {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) return;
    setDraft('');
    onPrompt(message);
  };
  return <section className="agent-console">
    <div className="agent-console-header"><div className="agent-identity"><div className="agent-avatar"><span /><span /><span /></div><div><strong>Ledgerline</strong><span>{thread?.senderShort || 'Invoice case'} · decision support</span></div></div><div className="agent-mode"><span className="agent-pulse" />{busy ? 'Working...' : currentActivity ? 'Result ready' : 'Ready'}<span className="agent-stack-flag">Harness</span></div></div>
    <div className="agent-conversation">
      <div className="agent-message"><div className="agent-message-avatar">LL</div><div className="agent-bubble"><div className="agent-bubble-meta">Assistant · {currentActivity ? 'analysis complete' : 'ready'}</div><p>{currentActivity ? 'I finished the review. The evidence and next action are below.' : 'Hi, I’m Ledgerline. I can investigate invoice exceptions, explain the evidence, and prepare a reply for your approval. What would you like me to do?'}</p></div></div>
      {currentActivity && <><div className="agent-user-message"><span>You</span><strong>{currentActivity.message}</strong></div><div className="agent-message follow-up-message"><div className="agent-message-avatar">LL</div><div className="agent-bubble"><div className="agent-bubble-meta">Assistant · response</div><p>{currentActivity.assistantMessage}</p>{hasCaseResult && <div className="assistant-case-card"><div className="case-result-header"><div><span className="case-result-kicker">Suggested classification</span><strong>{summary.label}</strong></div><span className="case-confidence">{Math.round(summary.score * 100)}%</span></div><div className="case-result-docs">{activeFirst.name} <span>↔</span> {activeSecond.name}</div>{summary.signals.length > 0 && <div className="agent-result-signals">{summary.signals.slice(0, 5).map((signal) => <span key={signal}>✓ {signal}</span>)}</div>}<div className="human-review-row"><span>Human decision</span><button className={activeAction === 'Mark as duplicate' ? 'review-choice chosen' : 'review-choice'} onClick={() => onChooseAction('Mark as duplicate')}>Mark duplicate</button><button className={activeAction === 'Request vendor confirmation' ? 'review-choice chosen' : 'review-choice'} onClick={() => onChooseAction('Request vendor confirmation')}>Request vendor confirmation</button><button className={activeAction === 'Mark as legitimate recurring' ? 'review-choice chosen' : 'review-choice'} onClick={() => onChooseAction('Mark as legitimate recurring')}>Recurring</button></div><div className="case-result-footer"><span>Proposal only · payment and ERP actions are unavailable</span>{onCopyReviewNote && <button className="case-note-button" onClick={onCopyReviewNote}>Copy review note</button>}</div></div>} {currentActivity.draft && <div className="draft-wrap"><pre className="draft-preview">{currentActivity.draft}</pre><button className="draft-copy" onClick={() => onCopyDraft(currentActivity.draft)}>Copy draft</button><span className="draft-safety">Draft only · not sent</span></div>} {hasCaseResult && <details className="chat-evidence"><summary>View evidence and documents <span>({summary.signals.length} signals)</span></summary><div className="chat-evidence-body"><div className="chat-document-grid"><DocumentCard document={activeFirst} label="Current" /><DocumentCard document={activeSecond} label="Reference" /></div><details className="chat-audit"><summary>Field audit · OCR, vision and reconciled values</summary><div className="table-wrap"><table><thead><tr><th>Field</th><th>OCR / rules</th><th>Vision</th><th>Reconciled</th></tr></thead><tbody>{fieldOrder.map((key) => <EvidenceRow key={key} document={activeFirst} fieldKey={key} />)}</tbody></table></div></details></div></details>}<details className="trace-details"><summary>Show work <span>({currentActivity.toolCalls.length} steps)</span></summary><div className="tool-trace">{currentActivity.toolCalls.map((call) => <div className="tool-trace-item" key={`${call.name}-${call.result}`}><span className="tool-status">✓</span><strong>{call.name.replaceAll('_', ' ')}</strong><span className="tool-result">{typeof call.result === 'string' ? call.result : call.result?.classification || call.result?.status || (Array.isArray(call.result?.signals) ? `${call.result.signals.length} signals` : 'Completed')}</span></div>)}</div></details></div></div></>}
      <form className="agent-input-row" onSubmit={submitPrompt}><input value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy || !thread} placeholder="Message Ledgerline..." aria-label="Message the Ledgerline agent" /><button className="agent-send" disabled={busy || !draft.trim() || !thread} type="submit">Send</button></form>
      <div className="agent-prompt"><span>{busy ? 'Working...' : 'Try asking'}</span><button disabled={busy || !thread} onClick={() => onPrompt('Classify these invoices')}>Classify invoices</button><button disabled={busy || !thread} onClick={() => onPrompt('Compare the evidence')}>Compare evidence</button><button disabled={busy || !thread} onClick={() => onPrompt('Draft a vendor reply')}>Draft supplier reply</button></div>
    </div>
  </section>;
}

function EvidenceRow({ document, fieldKey }) {
  const deterministic = document?.deterministic?.[fieldKey];
  const model = document?.model?.[fieldKey];
  const reconciled = document?.reconciled?.[fieldKey];
  const cell = (entry, value) => <td><span className="table-value">{value || '—'}</span>{entry?.evidence && <span className="evidence-snippet">“{String(entry.evidence).slice(0, 34)}{String(entry.evidence).length > 34 ? '…' : ''}”</span>}</td>;
  return <tr><td className="field-name">{FIELD_LABELS[fieldKey]}</td>{cell(deterministic, formatAuditValue(fieldKey, deterministic?.value))}{cell(model, formatAuditValue(fieldKey, model?.value))}<td><span className={`reconciled-value ${reconciled?.status || 'missing'}`}>{formatAuditValue(fieldKey, reconciled?.value)}</span><span className="confidence-line">{reconciled?.status === 'agreed' ? 'Agreed' : reconciled?.status === 'conflict' ? 'Conflict' : reconciled?.status === 'partial' ? 'Partial' : 'Missing'} · {Math.round((reconciled?.confidence || 0) * 100)}%</span></td></tr>;
}

function formatAuditValue(key, value) {
  if (value == null || value === '') return '—';
  if (['subtotal', 'tax', 'total'].includes(key)) return money(value);
  return String(value);
}

function EmptyState({ onImport }) {
  return <div className="empty-state"><div className="empty-illustration"><span>▤</span><span>⌁</span><span>?</span></div><h2>Bring two invoices together</h2><p>Import a current invoice and one or more reference PDFs to see duplicate signals, extraction disagreements, and next actions.</p><button className="primary-button" onClick={onImport}>Import invoice files</button></div>;
}

createRoot(document.getElementById('root')).render(<App />);
