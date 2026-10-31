import { Router, type Request, type Response } from 'express';
import { events, type AppEvent } from '../../lib/events';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events: one long-lived HTTP response per open tab. Staff get
 * every event; a portal customer gets only events about their own records.
 */
export const realtimeRoutes = Router().get('/', (req: Request, res: Response) => {
  const user = req.user!;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);

  const onEvent = (event: AppEvent) => {
    if (user.role === 'customer' && event.customerId !== user.customerId) return;
    if (user.role === 'customer' && event.type === 'billing.progress') return;
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  };
  events.on('event', onEvent);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

  req.on('close', () => {
    clearInterval(heartbeat);
    events.off('event', onEvent);
  });
});
