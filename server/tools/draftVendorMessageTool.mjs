import { createVendorDraft } from './toolUtils.mjs';

export function draftVendorMessageTool(input = {}, { thread, summary, documents } = {}) {
  if (typeof input.purpose !== 'string' || input.purpose.length > 240) return { error: 'Draft purpose is invalid.' };
  return createVendorDraft(thread, summary, documents);
}
