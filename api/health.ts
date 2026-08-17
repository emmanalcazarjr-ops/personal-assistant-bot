/** Simple health check. */
import type { IncomingMessage, ServerResponse } from 'node:http';

export default function health(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, service: 'personal-assistant-bot', ts: Date.now() }));
}
