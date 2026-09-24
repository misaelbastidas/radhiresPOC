import { valueOf } from '../../src/lib/invoiceEngine.js';
import { documentSubset } from './toolUtils.mjs';

export function validateInvoiceMathTool(input = {}, { documents } = {}) {
  return {
    documents: documentSubset(documents, input.documentIds).map((document) => {
      const fields = document.reconciled || document.deterministic || {};
      const subtotal = Number(valueOf(fields, 'subtotal'));
      const tax = Number(valueOf(fields, 'tax'));
      const total = Number(valueOf(fields, 'total'));
      const valid = [subtotal, tax, total].every(Number.isFinite) && Math.abs((subtotal + tax) - total) <= 0.02;
      return { id: document.id, name: document.name, valid, subtotal, tax, total };
    })
  };
}
