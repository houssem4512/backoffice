import { Request, Response, NextFunction } from 'express';

export class ApiError extends Error {
  constructor(public statusCode: number, message: string, public details?: any) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route introuvable' });
}

export function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  // eslint-disable-next-line no-console
  console.error('[api-error]', err?.stack || err);
  const status = err?.statusCode || 500;
  const message = err?.message || 'Erreur serveur interne';
  const details = err?.details;
  res.status(status).json({ error: message, ...(details ? { details } : {}) });
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
