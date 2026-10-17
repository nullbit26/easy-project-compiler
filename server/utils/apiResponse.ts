import { Response } from 'express';

export function sendSuccess(res: Response, data: any) {
  return res.json({
    success: true,
    data
  });
}

export function sendError(res: Response, status: number, message: string, userMessage: string, details?: any) {
  return res.status(status).json({
    success: false,
    error: message,
    userMessage,
    details
  });
}
