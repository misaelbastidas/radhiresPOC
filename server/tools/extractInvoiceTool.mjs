import { compactFields, documentSubset } from './toolUtils.mjs';

export function extractInvoiceTool(input = {}, { documents } = {}) {
  return {
    documents: documentSubset(documents, input.documentIds).map((document) => ({
      id: document.id,
      name: document.name,
      extractionMethod: document.extractionMethod,
      fields: compactFields(document.reconciled || document.deterministic)
    }))
  };
}
