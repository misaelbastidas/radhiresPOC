import { compareDocumentsTool } from './compareDocumentsTool.mjs';
import { draftVendorMessageTool } from './draftVendorMessageTool.mjs';
import { extractInvoiceTool } from './extractInvoiceTool.mjs';
import { findSimilarInvoicesTool } from './findSimilarInvoicesTool.mjs';
import { scanInboxTool } from './scanInboxTool.mjs';
import { validateInvoiceMathTool } from './validateInvoiceMathTool.mjs';

export const deterministicToolExecutors = Object.freeze({
  scan_inbox: scanInboxTool,
  extract_invoice: extractInvoiceTool,
  find_similar_invoices: findSimilarInvoicesTool,
  compare_documents: compareDocumentsTool,
  validate_invoice_math: validateInvoiceMathTool,
  draft_vendor_message: draftVendorMessageTool
});
