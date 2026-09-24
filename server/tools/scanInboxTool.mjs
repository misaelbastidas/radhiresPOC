export function scanInboxTool(input = {}, { thread } = {}) {
  if (input.threadId && input.threadId !== thread.id) return { error: 'The tool is scoped to the selected thread.' };
  return {
    threadId: thread.id,
    sender: thread.sender,
    senderEmail: thread.senderEmail,
    subject: thread.subject,
    attachments: thread.attachments,
    readOnly: true
  };
}
