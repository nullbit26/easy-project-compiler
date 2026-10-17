import { Router } from 'express';
import { getPreviewStatus, postPreviewBuild } from '../controllers/preview.controller';
import { requireLocal } from '../utils/localRequest';

const router = Router();

// The preview reads the user's real project folder, so it is as local-only as the file screens.
router.use((req, res, next) => {
  const allowed = requireLocal(
    req,
    res,
    'The project preview can only run on the machine that owns the folder (localhost).'
  );
  if (!allowed) return;
  next();
});

router.get('/status', getPreviewStatus);
router.post('/build', postPreviewBuild);

export default router;
