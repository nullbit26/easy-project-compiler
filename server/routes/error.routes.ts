import { Router } from 'express';
import { diagnoseError } from '../controllers/error.controller';

const router = Router();

router.post('/diagnose', diagnoseError);

export default router;
