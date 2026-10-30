import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

// A stand-in for Resend's POST /emails that behaves as resend.com/docs describes idempotency:
//   * a new Idempotency-Key: the email is accepted (counted as sent) and gets a new id;
//   * the same key with the same body: the original id comes back, and nothing is sent again;
//   * the same key with a different body: 409 invalid_idempotent_request.
// A test can make the next request for a key fail, or be accepted without an answer ('hang'), as
// if the caller crashed after Resend had accepted the email. It can also take the whole service
// down (every request gets the same error, nothing is sent) and slow every answer down.

export type ReceivedRequest = { key: string | undefined; headers: IncomingHttpHeaders; body: string };
type Answer = 'hang' | { status: number; body: unknown; headers?: Record<string, string> };

export async function startFakeResend() {
  const requests: ReceivedRequest[] = [];
  const sent = new Map<string, { id: string; body: string }>();
  const nextAnswers = new Map<string, Answer>();
  let outage: { status: number; name: string; message: string } | null = null;
  let delayMs = 0;

  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString('utf8');
    const key = req.headers['idempotency-key'] as string | undefined;
    requests.push({ key, headers: req.headers, body });
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const reply = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(payload));
    };
    if (req.method !== 'POST' || req.url !== '/emails') {
      return reply(404, { statusCode: 404, name: 'not_found', message: 'The requested endpoint does not exist.' });
    }
    if (outage) return reply(outage.status, { statusCode: outage.status, name: outage.name, message: outage.message });

    const answer = key ? nextAnswers.get(key) : undefined;
    if (key) nextAnswers.delete(key);
    if (answer && answer !== 'hang') return reply(answer.status, answer.body, answer.headers);

    const previous = key ? sent.get(key) : undefined;
    if (previous) {
      return previous.body === body
        ? reply(200, { id: previous.id })
        : reply(409, { statusCode: 409, name: 'invalid_idempotent_request', message: 'The request body does not match the original request.' });
    }
    const id = randomUUID();
    if (key) sent.set(key, { id, body });
    if (answer === 'hang') return; // accepted and "sent", but the answer never arrives
    reply(200, { id });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    // The requests made with this key, oldest first.
    requestsFor: (key: string) => requests.filter((request) => request.key === key),
    // The email "sent" for this key (at most one, however often it was requested).
    sentFor: (key: string) => sent.get(key),
    answerNext(key: string, answer: Answer) {
      nextAnswers.set(key, answer);
    },
    // Every request fails like this until it is set back to null (nothing is sent meanwhile).
    setOutage(error: { status: number; name: string; message: string } | null) {
      outage = error;
    },
    // Every answer comes this much later (so that overlapping runs really overlap).
    setDelay(ms: number) {
      delayMs = ms;
    },
    async waitForRequest(key: string) {
      for (let attempt = 0; attempt < 120; attempt++) {
        if (requests.some((request) => request.key === key)) return;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`no request for ${key} reached the fake Resend`);
    },
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
