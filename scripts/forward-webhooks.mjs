// LOCAL DEVELOPMENT ONLY: lets Resend reach the local resend-webhook function through a tunnel,
// without exposing the rest of the local stack. A tunnel straight to the API gateway (port 54321)
// would publish the whole local Supabase API, whose keys are the well-known local defaults.
//
//   npm run webhook:forward            (listens on http://127.0.0.1:54399)
//   cloudflared tunnel --url http://127.0.0.1:54399
//
// Then register https://<tunnel host>/resend-webhook as the webhook URL in Resend. Only POST
// /resend-webhook is passed on (body untouched, with its svix-* headers); everything else is 404.
import { createServer } from 'node:http';

const PORT = Number(process.env.WEBHOOK_FORWARD_PORT ?? 54399);
const TARGET = 'http://127.0.0.1:54321/functions/v1/resend-webhook';
const MAX_BODY_BYTES = 256 * 1024;
const PASSED_HEADERS = ['content-type', 'svix-id', 'svix-timestamp', 'svix-signature'];

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method !== 'POST' || path !== '/resend-webhook') {
    // Shown, because a webhook URL without the /resend-webhook path ends up here.
    console.log(`${new Date().toISOString()}  refused ${req.method} ${path} (only POST /resend-webhook is passed on)`);
    res.writeHead(404).end();
    return;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      res.writeHead(413).end();
      return;
    }
    chunks.push(chunk);
  }

  const headers = {};
  for (const name of PASSED_HEADERS) {
    const value = req.headers[name];
    if (typeof value === 'string') headers[name] = value;
  }

  try {
    const response = await fetch(TARGET, { method: 'POST', headers, body: Buffer.concat(chunks) });
    const text = await response.text();
    console.log(`${new Date().toISOString()}  ${headers['svix-id'] ?? '(no svix-id)'}  ${response.status}  ${text}`);
    res.writeHead(response.status, { 'Content-Type': 'application/json' }).end(text);
  } catch (error) {
    console.error(`${new Date().toISOString()}  could not reach the local function: ${error.message}`);
    res.writeHead(502).end();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Forwarding POST http://127.0.0.1:${PORT}/resend-webhook -> ${TARGET}`);
  console.log(`Now run: cloudflared tunnel --url http://127.0.0.1:${PORT}`);
});
