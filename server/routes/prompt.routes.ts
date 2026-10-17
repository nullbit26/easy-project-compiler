import { Router } from 'express';
import { compilePrompt } from '../controllers/prompt.controller';

const router = Router();

router.post('/compile', compilePrompt);

export default router;
