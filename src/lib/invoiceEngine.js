const FIELD_KEYS = [
  'vendorName',
  'vendorTaxId',
  'invoiceNumber',
  'invoiceDate',
  'purchaseOrder',
  'currency',
  'subtotal',
  'tax',
  'total',
  'servicePeriod',
  'paymentTerms'
];

export const FIELD_LABELS = {
  vendorName: 'Vendor',
  vendorTaxId: 'Tax ID',
  invoiceNumber: 'Invoice number',
  invoiceDate: 'Invoice date',
  purchaseOrder: 'Purchase order',
  currency: 'Currency',
  subtotal: 'Subtotal',
  tax: 'Tax',
  total: 'Total',
  servicePeriod: 'Service period',
  paymentTerms: 'Payment terms'
};

export const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

function field(value, confidence, evidence = null, page = null, source = 'deterministic') {
  return { value: value ?? null, confidence: value == null ? 0 : confidence, evidence, page, source };
}

function parseAmount(value) {
  if (value == null) return null;
  const raw = String(value).replace(/[^\d,.-]/g, '');
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(',');
  const lastPeriod = raw.lastIndexOf('.');
  let normalized = raw;
  if (lastComma > lastPeriod) {
    normalized = lastComma >= raw.length - 3
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else {
    normalized = lastPeriod >= raw.length - 3 ? raw.replace(/,/g, '') : raw.replace(/[.,]/g, '');
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function firstMatch(text, patterns) {
  const candidates = Array.isArray(patterns) ? patterns : [patterns];
  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (match?.[1]) return { value: normalizeText(match[1]), evidence: normalizeText(match[0]) };
  }
  return null;
}

function dateValue(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  const iso = trimmed.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const slash = trimmed.match(/(\d{1,2})[/-](\d{1,2})[/-](20\d{2})/);
  if (slash) return `${slash[3]}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`;
  return trimmed;
}

export function parseInvoiceFields(rawText, pages = []) {
  const text = normalizeText(rawText);
  const result = { lineItems: [], warnings: [] };
  const matches = {
    vendorName: firstMatch(text, [/(?:vendor|supplier|from)\s*[:#-]?\s*([A-Za-z0-9 &.,'-]{3,}?)(?=\s+(?:tax\s*id|vat|rfc|invoice|date|purchase|currency|service|subtotal|tax|total|payment)\b|$)/i]),
    vendorTaxId: firstMatch(text, /(?:tax\s*id|vat|rfc)\s*[:#-]?\s*([A-Z0-9-]{5,})/i),
    invoiceNumber: firstMatch(text, [/(?:invoice\s*(?:number|no\.?|#|id))\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i, /(?:factura|folio)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i]),
    invoiceDate: firstMatch(text, [/(?:invoice\s*date|date\s*issued|fecha)\s*[:#-]?\s*([0-9]{1,4}[/-][0-9]{1,2}[/-][0-9]{1,4})/i]),
    purchaseOrder: firstMatch(text, [/(?:purchase\s*order|po\s*(?:number|no\.?|#)?|orden\s*de\s*compra)\s*[:#-]?\s*([A-Z0-9][A-Z0-9/_-]{2,})/i]),
    currency: firstMatch(text, [/(?:currency|moneda)\s*[:#-]?\s*(USD|EUR|MXN|GBP|CAD|\$|€|£)/i]),
    servicePeriod: firstMatch(text, [/(?:service\s*period|period|billing\s*period|periodo)\s*[:#-]?\s*([^;|]{4,40}?)(?=\s+(?:subtotal|tax|total|payment)\b|$)/i]),
    paymentTerms: firstMatch(text, [/(?:payment\s*terms|terms|condiciones)\s*[:#-]?\s*([^;|]{2,30}?)(?=\s+(?:subtotal|tax|total)\b|$)/i])
  };

  for (const key of ['vendorName', 'vendorTaxId', 'invoiceNumber', 'purchaseOrder', 'currency', 'servicePeriod', 'paymentTerms']) {
    const match = matches[key];
    result[key] = field(match?.value || null, match ? 0.94 : 0, match?.evidence || null, pages[0]?.page || 1);
  }
  result.invoiceDate = field(dateValue(matches.invoiceDate?.value), matches.invoiceDate ? 0.9 : 0, matches.invoiceDate?.evidence || null, pages[0]?.page || 1);

  for (const [key, labels] of Object.entries({
    subtotal: ['subtotal', 'sub-total', 'importe neto'],
    tax: ['tax', 'vat', 'iva'],
    total: ['total due', 'amount due', 'grand total', 'total']
  })) {
    const labelPattern = labels.join('|');
    const match = text.match(new RegExp(`\\b(?:${labelPattern})\\b\\s*[:#-]?\\s*([A-Z$€£]{0,4}\\s*[0-9][0-9.,]*)`, 'i'));
    const amount = parseAmount(match?.[1]);
    result[key] = field(amount, amount != null ? 0.91 : 0, match?.[0] ? normalizeText(match[0]) : null, pages[0]?.page || 1);
  }

  if (result.subtotal.value != null && result.tax.value != null && result.total.value != null) {
    const expected = Number((result.subtotal.value + result.tax.value).toFixed(2));
    if (Math.abs(expected - result.total.value) > 0.02) result.warnings.push('Subtotal plus tax does not reconcile to the reported total.');
  }
  if (!result.invoiceNumber.value) result.warnings.push('Invoice number was not found by deterministic extraction.');
  if (!result.total.value) result.warnings.push('Total amount was not found by deterministic extraction.');
  return result;
}

export function valueOf(extraction, key) {
  const value = extraction?.[key];
  return value && typeof value === 'object' && 'value' in value ? value.value : value ?? null;
}

export function confidenceOf(extraction, key) {
  const value = extraction?.[key];
  return value && typeof value === 'object' && 'confidence' in value ? Number(value.confidence || 0) : value == null ? 0 : 0.5;
}

function normalizeComparable(value) {
  if (value == null) return '';
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function closeAmounts(first, second) {
  const a = Number(first);
  const b = Number(second);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.02, Math.abs(a) * 0.001);
}

export function reconcileExtractions(deterministic, model) {
  const reconciled = { lineItems: [], warnings: [] };
  for (const key of FIELD_KEYS) {
    const deterministicValue = valueOf(deterministic, key);
    const modelValue = valueOf(model, key);
    const isNumeric = ['subtotal', 'tax', 'total'].includes(key);
    const agrees = deterministicValue != null && modelValue != null && (isNumeric ? closeAmounts(deterministicValue, modelValue) : normalizeComparable(deterministicValue) === normalizeComparable(modelValue));
    const selected = agrees ? deterministicValue : deterministicValue ?? modelValue;
    const status = deterministicValue == null && modelValue == null ? 'missing' : deterministicValue == null || modelValue == null ? 'partial' : agrees ? 'agreed' : 'conflict';
    const confidence = status === 'agreed' ? Math.min(0.99, Math.max(confidenceOf(deterministic, key), confidenceOf(model, key)) + 0.06) : status === 'conflict' ? Math.min(confidenceOf(deterministic, key), confidenceOf(model, key)) : Math.max(confidenceOf(deterministic, key), confidenceOf(model, key));
    reconciled[key] = {
      value: selected,
      deterministicValue,
      modelValue,
      confidence,
      status,
      evidence: [deterministic?.[key]?.evidence, model?.[key]?.evidence].filter(Boolean)
    };
    if (status === 'conflict') reconciled.warnings.push(`${FIELD_LABELS[key]} differs between extraction methods.`);
  }
  reconciled.lineItems = deterministic?.lineItems?.length ? deterministic.lineItems : model?.lineItems || [];
  reconciled.warnings = [...reconciled.warnings, ...(deterministic?.warnings || []), ...(model?.warnings || [])];
  return reconciled;
}

function tokenOverlap(first, second) {
  const a = new Set(normalizeText(first).toLowerCase().split(/\W+/).filter((token) => token.length > 2));
  const b = new Set(normalizeText(second).toLowerCase().split(/\W+/).filter((token) => token.length > 2));
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / Math.max(a.size, b.size);
}

export function scoreDuplicate(first, second) {
  const signals = [];
  let score = 0;
  if (normalizeComparable(valueOf(first, 'vendorName')) && normalizeComparable(valueOf(first, 'vendorName')) === normalizeComparable(valueOf(second, 'vendorName'))) {
    score += 0.22;
    signals.push('Same vendor');
  }
  if (normalizeComparable(valueOf(first, 'invoiceNumber')) && normalizeComparable(valueOf(first, 'invoiceNumber')) === normalizeComparable(valueOf(second, 'invoiceNumber'))) {
    score += 0.36;
    signals.push('Same invoice number');
  }
  if (closeAmounts(valueOf(first, 'total'), valueOf(second, 'total'))) {
    score += 0.18;
    signals.push('Same total');
  }
  if (normalizeComparable(valueOf(first, 'purchaseOrder')) && normalizeComparable(valueOf(first, 'purchaseOrder')) === normalizeComparable(valueOf(second, 'purchaseOrder'))) {
    score += 0.1;
    signals.push('Same purchase order');
  }
  const firstPeriod = normalizeComparable(valueOf(first, 'servicePeriod'));
  const secondPeriod = normalizeComparable(valueOf(second, 'servicePeriod'));
  const periodsMatch = firstPeriod && secondPeriod && firstPeriod === secondPeriod;
  if (periodsMatch) {
    score += 0.08;
    signals.push('Overlapping service period');
  }
  const recurring = firstPeriod && secondPeriod && firstPeriod !== secondPeriod;
  if (recurring) score -= 0.3;
  const classification = score >= 0.72 ? 'likely-duplicate' : score >= 0.42 ? 'needs-review' : 'legitimate-recurring';
  const label = classification === 'likely-duplicate' ? 'Likely duplicate' : classification === 'needs-review' ? 'Needs review' : 'Likely legitimate recurring';
  return { score: Math.max(0, Math.min(0.99, score)), classification, label, signals, recurring };
}

export function buildDuplicatePairs(documents) {
  const pairs = [];
  for (let index = 0; index < documents.length; index += 1) {
    for (let other = index + 1; other < documents.length; other += 1) {
      const first = documents[index];
      const second = documents[other];
      const risk = scoreDuplicate(first.reconciled || first.deterministic, second.reconciled || second.deterministic);
      pairs.push({ id: `${first.id}-${second.id}`, firstId: first.id, secondId: second.id, ...risk });
    }
  }
  return pairs.sort((a, b) => b.score - a.score);
}

function demoField(value, evidence, confidence = 0.95) {
  return field(value, confidence, evidence, 1, 'demo');
}

export function getDemoDocuments() {
  const make = (id, name, fields, notes) => ({
    id,
    name,
    notes,
    pages: [{ page: 1, text: notes, imageDataUrl: null }],
    deterministic: fields,
    model: fields,
    reconciled: fields,
    source: 'demo'
  });
  const common = (invoiceNumber, date, period, total, evidence) => ({
    vendorName: demoField('Northstar Office Supply', evidence),
    vendorTaxId: demoField('US-84-0194421', 'Tax ID: US-84-0194421'),
    invoiceNumber: demoField(invoiceNumber, `Invoice number: ${invoiceNumber}`),
    invoiceDate: demoField(date, `Invoice date: ${date}`),
    purchaseOrder: demoField('PO-8841', 'Purchase order: PO-8841'),
    currency: demoField('USD', 'Currency: USD'),
    subtotal: demoField(total - 240, `Subtotal: ${(total - 240).toFixed(2)}`),
    tax: demoField(240, 'Tax: 240.00'),
    total: demoField(total, `Total due: ${total.toFixed(2)}`),
    servicePeriod: demoField(period, `Service period: ${period}`),
    paymentTerms: demoField('Net 30', 'Payment terms: Net 30'),
    lineItems: [],
    warnings: []
  });
  const firstNotes = `NORTHSTAR OFFICE SUPPLY\nTax ID: US-84-0194421\nInvoice number: NS-1042\nInvoice date: 2026-02-12\nPurchase order: PO-8841\nCurrency: USD\nService period: Jan 2026\nSubtotal: 1,260.00\nTax: 240.00\nTotal due: 1,500.00\nPayment terms: Net 30`;
  const secondNotes = `NORTHSTAR OFFICE SUPPLY\nTax ID: US-84-0194421\nInvoice number: NS-1042\nInvoice date: 2026-02-14\nPurchase order: PO-8841\nCurrency: USD\nService period: Jan 2026\nSubtotal: 1,260.00\nTax: 240.00\nTotal due: 1,500.00\nPayment terms: Net 30`;
  const thirdNotes = `NORTHSTAR OFFICE SUPPLY\nTax ID: US-84-0194421\nInvoice number: NS-1043\nInvoice date: 2026-03-12\nPurchase order: PO-8841\nCurrency: USD\nService period: Feb 2026\nSubtotal: 1,260.00\nTax: 240.00\nTotal due: 1,500.00\nPayment terms: Net 30`;
  return [
    make('inv-1042-a', 'northstar-invoice-1042.pdf', common('NS-1042', '2026-02-12', 'Jan 2026', 1500, 'Invoice number: NS-1042'), firstNotes),
    make('inv-1042-b', 'northstar-invoice-1042-resubmitted.pdf', common('NS-1042', '2026-02-14', 'Jan 2026', 1500, 'Invoice number: NS-1042'), secondNotes),
    make('inv-1043', 'northstar-invoice-1043.pdf', common('NS-1043', '2026-03-12', 'Feb 2026', 1500, 'Invoice number: NS-1043'), thirdNotes)
  ];
}

export function createSummary(pairs, documents) {
  const top = pairs[0];
  if (!top) return { label: 'No comparison yet', classification: 'empty', score: 0, signals: [], amount: 0 };
  const first = documents.find((document) => document.id === top.firstId);
  return {
    label: top.label,
    classification: top.classification,
    score: top.score,
    signals: top.signals,
    amount: valueOf(first?.reconciled || first?.deterministic, 'total') || 0
  };
}
