import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { recognize } from 'tesseract.js';
import { normalizeText, parseInvoiceFields } from './invoiceEngine';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_PAGES = 6;

function canvasToDataUrl(canvas) {
  return canvas.toDataURL('image/jpeg', 0.78);
}

export async function extractPdfDocument(file, onProgress = () => {}) {
  if (!file || typeof file.name !== 'string') throw new Error('A named invoice file is required.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Invoice files must be smaller than 12 MB.');
  const extension = file.name.toLowerCase().split('.').pop();
  if (extension === 'txt' || extension === 'md') {
    const text = await file.text();
    onProgress({ stage: 'text', page: 1, total: 1, progress: 1 });
    const pages = [{ page: 1, text, imageDataUrl: null, method: 'plain-text' }];
    return {
      id: `upload-${crypto.randomUUID()}`,
      name: file.name,
      bytes: file.size,
      pages,
      text,
      extractionMethod: 'plain-text',
      deterministic: parseInvoiceFields(text, pages),
      source: 'upload'
    };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  const pages = [];
  if (pdf.numPages > MAX_PAGES) throw new Error('Invoice PDFs may contain at most six pages.');
  const maxPages = pdf.numPages;
  let usedOcr = false;

  for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
    onProgress({ stage: 'render', page: pageNumber, total: maxPages, progress: (pageNumber - 1) / maxPages });
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.55 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    await page.render({ canvasContext: context, viewport }).promise;
    const imageDataUrl = canvasToDataUrl(canvas);
    const textContent = await page.getTextContent();
    let text = textContent.items.map((item) => item.str).join(' ');
    let method = 'pdf-text';

    if (normalizeText(text).length < 50) {
      usedOcr = true;
      method = 'tesseract-wasm';
      onProgress({ stage: 'ocr', page: pageNumber, total: maxPages, progress: (pageNumber - 0.5) / maxPages });
      const result = await recognize(imageDataUrl, 'eng', {
        logger: (message) => {
          if (message.status === 'recognizing text' && typeof message.progress === 'number') {
            onProgress({ stage: 'ocr', page: pageNumber, total: maxPages, progress: (pageNumber - 1 + message.progress) / maxPages });
          }
        }
      });
      text = result.data.text;
    }

    pages.push({ page: pageNumber, text, imageDataUrl, method });
    onProgress({ stage: 'complete', page: pageNumber, total: maxPages, progress: pageNumber / maxPages });
  }

  const fullText = pages.map((page) => page.text).join('\n');
  return {
    id: `upload-${crypto.randomUUID()}`,
    name: file.name,
    bytes: file.size,
    pages,
    text: fullText,
    extractionMethod: usedOcr ? 'pdf-text + tesseract-wasm' : 'pdf-text',
    deterministic: parseInvoiceFields(fullText, pages),
    source: 'upload'
  };
}

export async function requestModelExtraction(document, deterministicFields) {
  const response = await fetch('/api/model-extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      documentName: document.name,
      pages: document.pages,
      text: document.text,
      deterministicFields
    })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Model extraction failed.');
  return body;
}
