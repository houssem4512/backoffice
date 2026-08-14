import { Router } from 'express';
import { Company } from '../models/Company';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

const router = Router();

// GET /api/bo/companies/stats
router.get(
  '/stats',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [total, byStatus, byContract, revenueAgg] = await Promise.all([
      Company.countDocuments(),
      Company.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Company.aggregate([{ $group: { _id: '$contractType', count: { $sum: 1 } } }]),
      Company.aggregate([{ $group: { _id: null, total: { $sum: '$monthlyFee' } } }]),
    ]);
    const statusMap: Record<string, number> = {};
    for (const s of byStatus as any[]) statusMap[s._id || 'unknown'] = s.count;
    const contractMap: Record<string, number> = {};
    for (const s of byContract as any[]) contractMap[s._id || 'unknown'] = s.count;
    res.json({
      total,
      active: statusMap['Actif'] || 0,
      prospects: statusMap['Prospect'] || 0,
      inactive: statusMap['Inactif'] || 0,
      suspended: statusMap['Suspendu'] || 0,
      mrr: revenueAgg[0]?.total || 0,
      by_status: statusMap,
      by_contract: contractMap,
    });
  })
);

// GET /api/bo/companies?page=1&limit=20
router.get(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Company.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Company.countDocuments(),
    ]);
    res.json({ data, total, page, limit });
  })
);

// PATCH /api/bo/companies/:id
router.patch(
  '/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const allowed = ['name', 'legalForm', 'industry', 'email', 'phone', 'city', 'website', 'contactName', 'contactRole', 'status', 'contractType', 'monthlyFee'];
    const update: any = {};
    for (const k of allowed) if (k in req.body) update[k] = req.body[k];
    const updated = await Company.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
    if (!updated) throw new ApiError(404, 'Société introuvable');
    res.json(updated);
  })
);

export default router;
