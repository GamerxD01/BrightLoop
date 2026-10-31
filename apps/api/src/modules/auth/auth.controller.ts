import type { CookieOptions, Request, Response } from 'express';
import { isProduction } from '../../config/env';
import { SESSION_COOKIE, SESSION_TTL_SECONDS } from '../../lib/security';
import { authService } from './auth.service';

const cookieOptions: CookieOptions = {
  httpOnly: true, // never readable from JavaScript
  sameSite: 'lax', // blocks cross-site POSTs carrying the cookie
  secure: isProduction,
  path: '/',
  maxAge: SESSION_TTL_SECONDS * 1000,
};

export const authController = {
  async signup(req: Request, res: Response) {
    const { user, token } = await authService.signup(req.body, req.id);
    res.cookie(SESSION_COOKIE, token, cookieOptions).status(201).json({ data: user });
  },

  async login(req: Request, res: Response) {
    const { user, token } = await authService.login(req.body);
    res.cookie(SESSION_COOKIE, token, cookieOptions).json({ data: user });
  },

  logout(_req: Request, res: Response) {
    res
      .clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined })
      .status(204)
      .end();
  },

  async me(req: Request, res: Response) {
    res.json({ data: await authService.me(req.user!.id) });
  },

  async forgotPassword(req: Request, res: Response) {
    await authService.requestPasswordReset(req.body.email);
    res
      .status(202)
      .json({ data: { message: 'If that email has an account, a reset link is on its way.' } });
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body, req.id);
    res.json({ data: { message: 'Password updated. Please sign in.' } });
  },
};
