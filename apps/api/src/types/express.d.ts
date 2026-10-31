import type { Logger } from 'pino';
import type { AuthUser } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      id: string;
      log: Logger;
      user?: AuthUser;
      validatedQuery?: unknown;
    }
  }
}

export {};
