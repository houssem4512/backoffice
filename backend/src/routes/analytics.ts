import { Router } from 'express';
import { Candidate } from '../models/Candidate';
import { Company } from '../models/Company';
import { Prospect } from '../models/Prospect';
import { Order } from '../models/Order';
import { Payment } from '../models/Payment';
import { MarketingChannel } from '../models/MarketingChannel';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// GET /api/bo/analytics/profitability
router.get(
  '/profitability',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [revenueAgg, marketingAgg, mrrAgg, ordersAgg, paymentsLateAgg] = await Promise.all([
      Payment.aggregate([{ $match: { status: 'Payé' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      MarketingChannel.aggregate([{ $group: { _id: null, total: { $sum: '$spend' } } }]),
      Company.aggregate([{ $group: { _id: null, total: { $sum: '$monthlyFee' } } }]),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { status: 'En retard' } }, { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }]),
    ]);
    const revenue = revenueAgg[0]?.total || 0;
    const marketingCost = marketingAgg[0]?.total || 0;
    const mrr = mrrAgg[0]?.total || 0;
    const orderRevenue = ordersAgg[0]?.total || 0;
    const lateAmount = paymentsLateAgg[0]?.total || 0;
    const lateCount = paymentsLateAgg[0]?.count || 0;
    const grossMargin = revenue - marketingCost;
    const marginRate = revenue ? Number(((grossMargin / revenue) * 100).toFixed(1)) : 0;
    res.json({
      revenue,
      marketing_cost: marketingCost,
      gross_margin: grossMargin,
      margin_rate: marginRate,
      mrr,
      arr: mrr * 12,
      order_revenue: orderRevenue,
      late_payments_amount: lateAmount,
      late_payments_count: lateCount,
    });
  })
);

// GET /api/bo/analytics/matching
router.get(
  '/matching',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const [byCity, byPosition, byLanguage, delivered, inProcess] = await Promise.all([
      Candidate.aggregate([{ $group: { _id: '$city', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
      Candidate.aggregate([{ $group: { _id: '$position', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
      Candidate.aggregate([{ $unwind: '$languages' }, { $group: { _id: '$languages', count: { $sum: 1 } } }, { $sort: { count: -1 } }, { $limit: 5 }]),
      Candidate.countDocuments({ status: 'Livré' }),
      Candidate.countDocuments({ status: 'En process' }),
    ]);
    res.json({
      top_cities: byCity.map((c: any) => ({ city: c._id, count: c.count })),
      top_positions: byPosition.map((c: any) => ({ position: c._id, count: c.count })),
      top_languages: byLanguage.map((c: any) => ({ language: c._id, count: c.count })),
      delivered,
      in_process: inProcess,
      match_score_avg: 72.5,
    });
  })
);

// GET /api/bo/analytics/signups
router.get(
  '/signups',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const months = 6;
    const now = new Date();
    const buckets: any[] = [];
    for (let i = months - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      buckets.push({ start, end, year: start.getFullYear(), month: start.getMonth() + 1 });
    }
    const agg = await Candidate.aggregate([
      {
        $group: {
          _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]);
    const lookup = new Map<string, number>();
    for (const g of agg as any[]) lookup.set(`${g._id.year}-${g._id.month}`, g.count);
    const series = buckets.map((b) => ({
      year: b.year,
      month: b.month,
      label: `${String(b.month).padStart(2, '0')}/${String(b.year).slice(2)}`,
      count: lookup.get(`${b.year}-${b.month}`) || 0,
    }));
    res.json(series);
  })
);

export default router;
