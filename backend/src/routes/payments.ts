import { Router } from 'express';
import { Payment } from '../models/Payment';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/bo/payments/stats
router.get(
  '/stats',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [total, byStatus, paidAgg, pendingAgg, byMethod] = await Promise.all([
      Payment.countDocuments(),
      Payment.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
      Payment.aggregate([{ $match: { status: 'Payé' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { status: { $in: ['En attente', 'En retard'] } } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Payment.aggregate([{ $group: { _id: '$method', count: { $sum: 1 } } }]),
    ]);
    const statusMap: Record<string, { count: number; amount: number }> = {};
    for (const s of byStatus as any[]) statusMap[s._id || 'unknown'] = { count: s.count, amount: s.amount };
    const methodMap: Record<string, number> = {};
    for (const s of byMethod as any[]) methodMap[s._id || 'unknown'] = s.count;
    res.json({
      total,
      paid: statusMap['Payé']?.count || 0,
      pending: statusMap['En attente']?.count || 0,
      late: statusMap['En retard']?.count || 0,
      partial: statusMap['Partiel']?.count || 0,
      cancelled: statusMap['Annulé']?.count || 0,
      refunded: statusMap['Remboursé']?.count || 0,
      paid_amount: paidAgg[0]?.total || 0,
      pending_amount: pendingAgg[0]?.total || 0,
      by_status: statusMap,
      by_method: methodMap,
    });
  })
);

// GET /api/bo/payments?page=1&limit=20
router.get(
  '/',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      Payment.find().sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Payment.countDocuments(),
    ]);
    res.json({ data, total, page, limit });
  })
);

export default router;
