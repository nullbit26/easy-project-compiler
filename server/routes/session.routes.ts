import { Router } from 'express';
import { reviewSession } from '../controllers/session.controller';

const router = Router();

router.post('/review', reviewSession);

export default router;
