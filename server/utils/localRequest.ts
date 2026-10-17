import { Request, Response } from 'express';
import { sendError } from './apiResponse';

/**
 * The user's own files and API keys belong to the machine that runs the app. In the packaged app
 * the server binds to 127.0.0.1, but `npm run dev` listens on every interface — without this guard
 * a device on the same Wi-Fi could read or write into the connected folder.
 */

export function isLocalRequest(req: Request): boolean {
  const address = req.socket?.remoteAddress || '';
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.startsWith('::ffff:127.')
  );
}

/** Answers with 403 and returns false when the request did not come from this machine. */
export function requireLocal(req: Request, res: Response, userMessage: string): boolean {
  if (isLocalRequest(req)) return true;
  sendError(res, 403, 'Local access only', userMessage);
  return false;
}
