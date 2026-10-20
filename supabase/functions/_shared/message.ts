import { escapeHtml } from './html.ts';

// A message ready to send, in the two forms every email carries.
export type RenderedMessage = { subject: string; html: string; text: string };

// Test-mode marking, applied at send time (the stored payload stays the real message).
export function markAsTest(message: RenderedMessage, intendedRecipient: string): RenderedMessage {
  const note = `TEST MESSAGE: in live mode this would have gone to ${intendedRecipient}.`;
  return {
    subject: `[TEST] ${message.subject}`,
    html: `<p style="background:#fef3c7;padding:8px;font-family:Arial,sans-serif">${escapeHtml(note)}</p>${message.html}`,
    text: `${note}\n\n${message.text}`,
  };
}
