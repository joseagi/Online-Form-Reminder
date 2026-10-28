// Provider-independent sending. Email goes through a NotificationProvider: Resend (resend.ts) or
// the log provider below. WhatsApp (Phase 8) will be a further implementation of the same interface.

export type OutboundMessage = {
  channel: 'email' | 'whatsapp';
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo: string | null;
};

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; retryable: boolean; code: string; message: string; httpStatus?: number; retryAfterSeconds?: number };

export interface NotificationProvider {
  readonly name: string;
  // Sending again with the same idempotencyKey must not deliver a second message.
  send(message: OutboundMessage, options: { idempotencyKey: string }): Promise<SendResult>;
}

// Delivers nothing: records that the message would have been sent. Used in test mode and
// whenever no real provider is configured. The rendered message is kept on the job, so an
// administrator can see exactly what would have gone out.
export class LogProvider implements NotificationProvider {
  readonly name = 'log';

  send(message: OutboundMessage, options: { idempotencyKey: string }): Promise<SendResult> {
    console.log(`[log provider] would send "${message.subject}" to ${message.to} (${options.idempotencyKey})`);
    return Promise.resolve({ ok: true, providerMessageId: `log:${options.idempotencyKey}` });
  }
}
