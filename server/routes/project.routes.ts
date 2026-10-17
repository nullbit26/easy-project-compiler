import { Router } from 'express';
import {
  generateQuestions,
  createIdea,
  adaptPlan,
  analyzeIdea,
  importWorkspace,
  describeImplemented
} from '../controllers/project.controller';
import { requireLocal } from '../utils/localRequest';

const router = Router();

router.post('/analyze-idea', analyzeIdea);
router.post('/generate-questions', generateQuestions);
router.post('/create-idea', createIdea);
router.post('/import-workspace', importWorkspace);
// Reading the user's own files can only ever be asked for from this machine.
router.post('/describe-implemented', (req, res, next) => {
  const allowed = requireLocal(
    req,
    res,
    'Project files can only be read or changed from the machine that runs the app (localhost).'
  );
  if (!allowed) return;
  next();
}, describeImplemented);
router.post('/adapt-plan', adaptPlan);

export default router;
