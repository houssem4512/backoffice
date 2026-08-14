import { Router } from 'express';
import { User } from '../models/User';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/bo/users?page=1&limit=20
router.get(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      User.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(),
    ]);
    res.json({ data, total, page, limit });
  })
);

export default router;
