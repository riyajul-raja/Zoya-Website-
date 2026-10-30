import { handleApiRequest } from '../../server/compiledApiHandler.js';

export default async function handler(req, res) {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled && !(res.writableEnded || res.headersSent)) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ success: false, error: 'Endpoint not found' }));
    }
  } catch (err) {
    console.error('Unhandled error in /api/devices/register:', err);
    if (!(res.writableEnded || res.headersSent)) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          success: false,
          error: err instanceof Error ? err.message : 'Internal Server Error',
        })
      );
    }
  }
}
