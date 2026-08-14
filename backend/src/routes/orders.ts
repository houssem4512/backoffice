import { Router } from 'express';
import { Order } from '../models/Order';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/bo/orders/stats
router.get(
  '/stats',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [total, byStatus, byType, totalAmountAgg] = await Promise.all([
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
      Order.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    const statusMap: Record<string, { count: number; amount: number }> = {};
    for (const s of byStatus as any[]) statusMap[s._id || 'unknown'] = { count: s.count, amount: s.amount };
    const typeMap: Record<string, number> = {};
    for (const s of byType as any[]) typeMap[s._id || 'unknown'] = s.count;
    res.json({
      total,
      pending: statusMap['En attente']?.count || 0,
      confirmed: statusMap['Confirmée']?.count || 0,
      in_progress: statusMap['En cours']?.count || 0,
      delivered: statusMap['Livrée']?.count || 0,
      cancelled: statusMap['Annulée']?.count || 0,
      late: statusMap['En retard']?.count || 0,
      total_amount: totalAmountAgg[0]?.total || 0,
      by_status: statusMap,
      by_type: typeMap,
    });
  })
);

// GET /api/bo/orders?page=1&limit=20
router.get(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Order.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Order.countDocuments(),
    ]);
    res.json({ data, total, page, limit });
  })
);

export default router;
