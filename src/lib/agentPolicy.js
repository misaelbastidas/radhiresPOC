export const MAX_AGENT_DOCUMENTS = 4;
export const MAX_DOCUMENT_PAGES = 6;
export const MAX_DOCUMENT_TEXT = 24000;

export function validateSelectedInvoiceFiles(files) {
  const selected = Array.from(files || []);
  if (selected.length > MAX_AGENT_DOCUMENTS) {
    return {
      ok: false,
      error: `Select at most ${MAX_AGENT_DOCUMENTS} PDFs so the agent context stays bounded.`
    };
  }

  const invalidFile = selected.find((file) => !file || typeof file.name !== 'string' || !/\.pdf$/i.test(file.name));
  if (invalidFile) {
    return { ok: false, error: 'Only PDF invoice files are supported in the analyst workspace.' };
  }

  return { ok: true, value: selected };
}
