import type { IncomingMessage, ServerResponse } from 'http';
import { handleApiRequest } from '../../apiHandler';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const handled = await handleApiRequest(req, res, '/api/releases/manifest');
    if (!handled && !(res.writableEnded || res.headersSent)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'Endpoint not found' }));
    }
  } catch (err: unknown) {
    console.error('Unhandled error in /api/releases/manifest:', err);
    if (!(res.writableEnded || res.headersSent)) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Internal Server Error',
        })
      );
    }
  }
}
