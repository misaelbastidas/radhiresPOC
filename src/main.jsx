import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { buildDuplicatePairs, createSummary, FIELD_LABELS, getDemoDocuments, reconcileExtractions, valueOf } from './lib/invoiceEngine';
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
  const [documents, setDocuments] = useState(() => finalizeDocuments(getDemoDocuments()));
  const [selectedPairId, setSelectedPairId] = useState(null);
  const [actions, setActions] = useState({});
  const [processing, setProcessing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [modelConfigured, setModelConfigured] = useState(false);

  const pairs = useMemo(() => buildDuplicatePairs(documents), [documents]);
  const summary = useMemo(() => createSummary(pairs, documents), [pairs, documents]);
  const activePair = pairs.find((pair) => pair.id === selectedPairId) || pairs[0];
  const activeFirst = documents.find((document) => document.id === activePair?.firstId) || documents[0];
  const activeSecond = documents.find((document) => document.id === activePair?.secondId) || documents[1];
  const activeAction = activePair ? actions[activePair.id] : null;

  useEffect(() => {
    fetch('/api/health').then((response) => response.json()).then((body) => setModelConfigured(Boolean(body.modelConfigured))).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedPairId && pairs[0]) setSelectedPairId(pairs[0].id);
  }, [pairs, selectedPairId]);

  const loadDemo = () => {
    setDocuments(finalizeDocuments(getDemoDocuments()));
    setActions({});
    setNotice({ tone: 'success', text: 'Loaded 3 synthetic invoices. The top pair is a deliberate resubmission.' });
    setTimeout(() => setNotice(null), 4200);
  };

  const processFiles = async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setProcessing({ stage: 'Starting', progress: 0, detail: 'Preparing local PDF extraction...' });
    setNotice(null);
    const next = [];
    try {
      for (const [index, file] of files.entries()) {
        const parsed = await extractPdfDocument(file, (progress) => {
          setProcessing({
            stage: progress.stage === 'ocr' ? 'OCR on device' : 'Reading PDF',
            progress: ((index + progress.progress) / files.length) * 100,
            detail: `${file.name} · page ${progress.page || 1} of ${progress.total || 1}`
          });
        });
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
      setDocuments(finalizeDocuments(next));
      setSelectedPairId(null);
      setNotice({ tone: 'success', text: `Analyzed ${next.length} invoice${next.length === 1 ? '' : 's'} locally. Select a pair to review the evidence.` });
    } catch (error) {
      setNotice({ tone: 'danger', text: error.message || 'The PDF could not be processed.' });
    } finally {
      setProcessing(null);
      event.target.value = '';
    }
  };

  const chooseAction = (action) => {
    if (!activePair) return;
    setActions((current) => ({ ...current, [activePair.id]: action }));
    setNotice({ tone: 'success', text: `Saved locally: ${action}. No payment or ERP action was taken.` });
    setTimeout(() => setNotice(null), 4200);
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><span /><span /><span /></div>
          <div><div className="brand-name">Ledgerline</div><div className="brand-subtitle">AP exception desk</div></div>
        </div>

        <div className="sidebar-actions">
          <button className="primary-button" onClick={() => inputRef.current?.click()}><span className="button-icon">＋</span> Import invoice files</button>
          <input ref={inputRef} type="file" accept="application/pdf,.pdf,.txt,.md" multiple hidden onChange={processFiles} />
          <button className="secondary-button" onClick={loadDemo}><span className="button-icon">↻</span> Load sample pack</button>
        </div>

        <div className="queue-heading"><span>Exception queue</span><span className="queue-count">{pairs.length}</span></div>
        <div className="queue-list">
          {pairs.map((pair) => {
            const first = documents.find((document) => document.id === pair.firstId);
            const action = actions[pair.id];
            return <button key={pair.id} className={`queue-item ${activePair?.id === pair.id ? 'selected' : ''}`} onClick={() => setSelectedPairId(pair.id)}>
              <div className="queue-item-top"><span className="queue-file">{first?.name?.replace('.pdf', '')}</span><span className="queue-score">{Math.round(pair.score * 100)}%</span></div>
              <div className="queue-item-bottom"><StatusPill classification={pair.classification} /><span>{action ? 'Action saved' : `${pair.signals.length} signals`}</span></div>
            </button>;
          })}
          {!pairs.length && <div className="empty-queue">Import at least two PDFs to create a comparison.</div>}
        </div>

        <div className="sidebar-footer">
          <div className="portable-card"><div className="portable-icon">⌁</div><div><strong>Runs locally</strong><span>OCR stays in your browser. Model calls are optional.</span></div></div>
          <div className="footer-meta"><span>v0.1 harness</span><span>•</span><span>synthetic data</span></div>
        </div>
      </aside>

      <main className="main-canvas">
        <header className="topbar">
          <div className="breadcrumb"><span>Accounts payable</span><span className="crumb-slash">/</span><strong>Invoice exceptions</strong></div>
          <div className="extractor-status"><span className="live-dot" /> <span>Deterministic OCR</span><span className="status-divider" /><span className={modelConfigured ? 'model-ready' : ''}>{modelConfigured ? 'Vision model ready' : 'Demo model adapter'}</span></div>
        </header>

        <div className="content-wrap">
          {notice && <div className={`notice ${notice.tone}`}><span>{notice.tone === 'success' ? '✓' : '!'}</span>{notice.text}</div>}
          {processing && <div className="processing-banner"><div className="spinner" /><div><strong>{processing.stage}</strong><span>{processing.detail}</span></div><div className="progress-track"><span style={{ width: `${Math.max(4, processing.progress)}%` }} /></div><span className="processing-percent">{Math.round(processing.progress)}%</span></div>}

          <section className="page-intro"><div><div className="eyebrow">Review workspace <span>•</span> {documents.length} documents</div><h1>Resolve before it becomes a payment.</h1><p>Compare extraction paths, follow the evidence, and decide what needs a human touch.</p></div><button className="text-button" onClick={copyReviewNote}>Copy review note <span>↗</span></button></section>

          {activePair && activeFirst && activeSecond ? <>
            <section className="decision-grid">
              <div className="decision-card">
                <div className="card-kicker"><span className="alert-icon">!</span> Duplicate review</div>
                <div className="decision-row"><div><h2>{summary.label}</h2><p>{activeFirst.name} and {activeSecond.name} share multiple payment signals.</p></div><ScoreRing score={summary.score} /></div>
                <div className="decision-footer"><span>Suggested next step</span><strong>{activeAction || (summary.classification === 'likely-duplicate' ? 'Request vendor confirmation' : 'Review supporting evidence')}</strong></div>
              </div>
              <div className="amount-card"><div className="amount-label">Amount potentially at risk</div><div className="amount-value">{compactMoney(summary.amount)}</div><div className="amount-meta"><span className="amount-trend">↗</span> If both invoices enter the ledger</div><div className="amount-bottom"><span>Reported total</span><strong>{money(summary.amount)}</strong></div></div>
            </section>

            <section className="signal-strip"><div className="signal-intro"><span className="signal-icon">⌁</span><div><strong>Why it was flagged</strong><span>Transparent signals, no black-box score.</span></div></div>{summary.signals.map((signal) => <div className="signal-chip" key={signal}><span>✓</span>{signal}</div>)}</section>

            <section className="panel document-panel">
              <div className="panel-header"><div><div className="panel-label">Document pair</div><h3>Compare the source invoices</h3></div><span className="panel-meta">{activeFirst.extractionMethod || 'Demo extraction'} · {activeSecond.extractionMethod || 'Demo extraction'}</span></div>
              <div className="document-compare"><DocumentCard document={activeFirst} label="Current invoice" /><div className="versus">VS</div><DocumentCard document={activeSecond} label="Reference invoice" /></div>
            </section>

            <div className="lower-grid">
              <section className="panel evidence-panel"><div className="panel-header"><div><div className="panel-label">Extraction audit</div><h3>Where the result came from</h3></div><span className="confidence-summary"><span className="mini-dot green" /> Agreement boosts confidence</span></div><div className="table-wrap"><table><thead><tr><th>Field</th><th>OCR / rules</th><th>Vision model</th><th>Reconciled</th></tr></thead><tbody>{fieldOrder.map((key) => <EvidenceRow key={key} document={activeFirst} fieldKey={key} />)}</tbody></table></div></section>
              <section className="panel action-panel"><div className="panel-label">Human decision</div><h3>What should happen next?</h3><p className="action-copy">The harness prepares the evidence. You decide whether the exception is safe to clear.</p><div className="action-list"><button className={activeAction === 'Mark as duplicate' ? 'action-button chosen' : 'action-button'} onClick={() => chooseAction('Mark as duplicate')}><span className="action-symbol danger-symbol">×</span><span><strong>Mark as duplicate</strong><small>Keep payment blocked</small></span><span className="action-arrow">→</span></button><button className={activeAction === 'Request vendor confirmation' ? 'action-button chosen' : 'action-button'} onClick={() => chooseAction('Request vendor confirmation')}><span className="action-symbol warning-symbol">↗</span><span><strong>Request vendor confirmation</strong><small>Draft a clarification email</small></span><span className="action-arrow">→</span></button><button className={activeAction === 'Mark as legitimate recurring' ? 'action-button chosen' : 'action-button'} onClick={() => chooseAction('Mark as legitimate recurring')}><span className="action-symbol success-symbol">✓</span><span><strong>Mark as legitimate recurring</strong><small>Clear this exception</small></span><span className="action-arrow">→</span></button></div><div className="guardrail-note"><span>◈</span><span><strong>No payment action taken</strong> This POC only saves the decision in the current session.</span></div></section>
            </div>
          </> : <EmptyState onImport={() => inputRef.current?.click()} />}
        </div>
      </main>
    </div>
  );
}

function DocumentCard({ document, label }) {
  return <div className="document-card"><div className="document-card-head"><span className="document-label">{label}</span><span className="file-type">PDF</span></div><div className="document-name"><span className="pdf-icon">▤</span><span>{document.name}</span></div><div className="document-stats"><span>{document.pages?.length || 1} page{document.pages?.length === 1 ? '' : 's'}</span><span>•</span><span>{document.extractionMethod || 'sample'}</span></div><div className="doc-total"><span>Reported total</span><strong>{money(valueOf(document.reconciled || document.deterministic, 'total'))}</strong></div></div>;
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
  return <div className="empty-state"><div className="empty-illustration"><span>▤</span><span>⌁</span><span>?</span></div><h2>Bring two invoices together</h2><p>Import a current invoice and one or more reference PDFs or editable text fixtures to see duplicate signals, extraction disagreements, and next actions.</p><button className="primary-button" onClick={onImport}>Import invoice files</button></div>;
}

createRoot(document.getElementById('root')).render(<App />);
