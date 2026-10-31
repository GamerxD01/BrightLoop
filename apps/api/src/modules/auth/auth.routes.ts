import { Router } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
} from '@brightloop/shared';
import { authenticate } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';

const strict = rateLimit({ windowMs: 15 * 60_000, max: 10 });

export const authRoutes = Router()
  .post('/signup', strict, validate(signupSchema), authController.signup)
  .post('/login', strict, validate(loginSchema), authController.login)
  .post('/logout', authController.logout)
  .get('/me', authenticate, authController.me)
  .post('/forgot-password', strict, validate(forgotPasswordSchema), authController.forgotPassword)
  .post('/reset-password', strict, validate(resetPasswordSchema), authController.resetPassword);
