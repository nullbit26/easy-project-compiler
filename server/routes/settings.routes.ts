import { Router, Request, Response } from 'express';
import {
  ApiKeyError,
  ProviderId,
  getProviderStatuses,
  isProviderId,
  saveApiKey,
  removeApiKey,
  getActiveProvider
} from '../store/apiKeyStore';
import { getLastAiModel, testProviderKey } from '../ai/aiProvider';
import { sendError, sendSuccess } from '../utils/apiResponse';
import { requireLocal } from '../utils/localRequest';

const router = Router();

function buildStatusPayload() {
  return {
    providers: getProviderStatuses(),
    activeProvider: getActiveProvider(),
    lastModel: getLastAiModel()
  };
}

/**
 * Keys are stored for the machine that runs the server, so only that machine
 * (the desktop app on loopback) is allowed to change them. Reading stays masked.
 */
function requireLocalKeyChange(req: Request, res: Response): boolean {
  return requireLocal(
    req,
    res,
    'API keys can only be changed from the machine that runs the app (localhost).'
  );
}

router.get('/api-keys', (_req: Request, res: Response) => {
  return sendSuccess(res, buildStatusPayload());
});

router.put('/api-keys/:provider', (req: Request, res: Response) => {
  if (!requireLocalKeyChange(req, res)) return;
  const provider = req.params.provider;
  if (!isProviderId(provider)) {
    return sendError(res, 400, 'Unknown provider', 'Unknown API provider.', { reason: 'unknown_provider' });
  }
  try {
    saveApiKey(provider as ProviderId, req.body?.key);
    return sendSuccess(res, buildStatusPayload());
  } catch (err) {
    if (err instanceof ApiKeyError) {
      return sendError(res, 422, err.message, err.message, { reason: err.code });
    }
    console.error('[API Keys] Failed to save the key.');
    return sendError(res, 500, 'Save failed', 'The key could not be saved.');
  }
});

router.delete('/api-keys/:provider', (req: Request, res: Response) => {
  if (!requireLocalKeyChange(req, res)) return;
  const provider = req.params.provider;
  if (!isProviderId(provider)) {
    return sendError(res, 400, 'Unknown provider', 'Unknown API provider.', { reason: 'unknown_provider' });
  }
  try {
    removeApiKey(provider as ProviderId);
    return sendSuccess(res, buildStatusPayload());
  } catch (err) {
    console.error('[API Keys] Failed to remove the key.');
    return sendError(res, 500, 'Remove failed', 'The key could not be removed.');
  }
});

router.post('/api-keys/:provider/test', async (req: Request, res: Response) => {
  if (!requireLocalKeyChange(req, res)) return;
  const provider = req.params.provider;
  if (!isProviderId(provider)) {
    return sendError(res, 400, 'Unknown provider', 'Unknown API provider.', { reason: 'unknown_provider' });
  }
  try {
    const result = await testProviderKey(provider as ProviderId);
    return sendSuccess(res, result);
  } catch (err) {
    console.error('[API Keys] Provider test failed unexpectedly.');
    return sendError(res, 502, 'Test failed', 'The provider could not be reached.');
  }
});

export default router;
