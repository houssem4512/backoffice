import { Router } from 'express';
import mongoose from 'mongoose';
import { MarketingChannel } from '../models/MarketingChannel';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// ---------------------------------------------------------------------------
// Helper — get the raw `marketing_campaigns` collection (the one seedMarketing.ts writes to).
// We bypass Mongoose because the MarketingChannel model has a different
// schema (platform / conversions / cpl / cpa) than what seedMarketing.ts writes
// (channel / category / source / segment / budget / spend / leads / prospects / clients).
// ---------------------------------------------------------------------------
function campaignsCol() {
  return mongoose.connection.db!.collection('marketing_campaigns');
}

// ---------------------------------------------------------------------------
// GET /api/bo/marketing/campaigns?page=1&limit=100
// Returns: { data: Campaign[], total, page, limit }
// (the page also accepts a bare array, but we return the standard ListShape)
// ---------------------------------------------------------------------------
router.get(
  '/campaigns',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const page = Math.max(parseInt(req.query.page as string) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      campaignsCol()
        .find({})
        .sort({ created_at: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      campaignsCol().countDocuments({}),
    ]);

    res.json({ data, total, page, limit });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/marketing/campaigns/:id
// ---------------------------------------------------------------------------
router.get(
  '/campaigns/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;
    let query: any = { campaign_id: id };
    // Also try by _id if it's a valid ObjectId
    if (mongoose.isValidObjectId(id)) {
      query = { $or: [{ campaign_id: id }, { _id: new mongoose.Types.ObjectId(id) }] };
    }
    const doc = await campaignsCol().findOne(query);
    if (!doc) {
      res.status(404).json({ error: 'Campagne non trouvée' });
      return;
    }
    res.json(doc);
  })
);

// ---------------------------------------------------------------------------
// POST /api/bo/marketing/campaigns
// Body accepts either English or French aliases (channel/canal, budget, spend/depense, etc.)
// ---------------------------------------------------------------------------
router.post(
  '/campaigns',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body || {};
    const now = new Date();

    // Build a normalized doc — accept multiple aliases for each field
    const channel = body.channel || body.canal || body.platform || 'Autre';
    const category = body.category || body.categorie || (
      ['Facebook', 'Google', 'TikTok', 'Emailing', 'Affiliation', 'Créations'].includes(channel)
        ? 'Candidats'
        : 'Prospects'
    );
    const source = body.source || body.origine || body.lead_source || 'Autres';
    const data: any = {
      campaign_id:    body.campaign_id || body.campaignId || `MRK-${Date.now()}`,
      campaign_reference: body.campaign_reference || body.campaignReference || `REF-MRK-${Date.now()}`,
      name:           body.name || body.nom || body.campaign_name || `${channel} Campaign`,
      channel,
      category,
      source,
      segment:        body.segment || body.experience || null,
      budget:         Number(body.budget || body.budget_total || 0),
      spend:          Number(body.spend || body.depense || body.cost || body.cout || 0),
      leads:          Number(body.leads || body.leads_count || body.nb_leads || 0),
      prospects:      Number(body.prospects || body.prospect_count || 0),
      clients:        Number(body.clients || body.client_count || body.converted || 0),
      language:       body.language || body.langue || 'Français',
      city:           body.city || body.ville || 'Tunis',
      gender:         body.gender || body.genre || body.sexe || 'Homme',
      start_date:     body.start_date || body.startDate || now,
      end_date:       body.end_date || body.endDate || null,
      created_at:     now,
      updated_at:     now,
      description:    body.description || '',
    };

    const result = await campaignsCol().insertOne(data);
    res.status(201).json({ ...data, _id: result.insertedId });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/bo/marketing/campaigns/:id
// ---------------------------------------------------------------------------
router.patch(
  '/campaigns/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;
    const body = req.body || {};
    delete body._id; // never overwrite _id

    const $set: any = { updated_at: new Date() };
    // Map common aliases to canonical fields
    if (body.name !== undefined)         $set.name = body.name;
    if (body.nom !== undefined)          $set.name = body.nom;
    if (body.channel !== undefined)      $set.channel = body.channel;
    if (body.canal !== undefined)        $set.channel = body.canal;
    if (body.category !== undefined)    $set.category = body.category;
    if (body.source !== undefined)       $set.source = body.source;
    if (body.segment !== undefined)     $set.segment = body.segment;
    if (body.budget !== undefined)      $set.budget = Number(body.budget);
    if (body.spend !== undefined)       $set.spend = Number(body.spend);
    if (body.depense !== undefined)     $set.spend = Number(body.depense);
    if (body.leads !== undefined)       $set.leads = Number(body.leads);
    if (body.prospects !== undefined)   $set.prospects = Number(body.prospects);
    if (body.clients !== undefined)     $set.clients = Number(body.clients);
    if (body.language !== undefined)    $set.language = body.language;
    if (body.city !== undefined)        $set.city = body.city;
    if (body.gender !== undefined)      $set.gender = body.gender;
    if (body.start_date !== undefined)  $set.start_date = body.start_date;
    if (body.end_date !== undefined)    $set.end_date = body.end_date;
    if (body.description !== undefined) $set.description = body.description;

    let query: any = { campaign_id: id };
    if (mongoose.isValidObjectId(id)) {
      query = { $or: [{ campaign_id: id }, { _id: new mongoose.Types.ObjectId(id) }] };
    }

    const result = await campaignsCol().findOneAndUpdate(
      query,
      { $set },
      { returnDocument: 'after' }
    );
    if (!result) {
      res.status(404).json({ error: 'Campagne non trouvée' });
      return;
    }
    res.json(result);
  })
);

// ---------------------------------------------------------------------------
// DELETE /api/bo/marketing/campaigns/:id
// ---------------------------------------------------------------------------
router.delete(
  '/campaigns/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { id } = req.params;
    let query: any = { campaign_id: id };
    if (mongoose.isValidObjectId(id)) {
      query = { $or: [{ campaign_id: id }, { _id: new mongoose.Types.ObjectId(id) }] };
    }
    const result = await campaignsCol().deleteOne(query);
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Campagne non trouvée' });
      return;
    }
    res.json({ success: true, deleted: result.deletedCount });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/marketing/stats — LEGACY endpoint (kept for backward-compat).
// Now also returns aggregated stats from the marketing_campaigns collection
// so the Marketing page (which computes KPIs locally) has a fallback source.
// ---------------------------------------------------------------------------
router.get(
  '/stats',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    // Try the new marketing_campaigns collection first
    const colExists = !!(await mongoose.connection.db!.listCollections({ name: 'marketing_campaigns' }).next());
    if (colExists) {
      const [totals, byChannelAgg, bySegmentAgg, bySourceAgg] = await Promise.all([
        campaignsCol().aggregate([
          { $group: {
            _id: null,
            totalBudget: { $sum: '$budget' },
            totalSpend:  { $sum: '$spend' },
            totalLeads:  { $sum: '$leads' },
            totalProspects: { $sum: '$prospects' },
            totalClients: { $sum: '$clients' },
          } },
        ]).toArray(),
        campaignsCol().aggregate([
          { $group: {
            _id: { channel: '$channel', category: '$category' },
            count: { $sum: 1 },
            budget: { $sum: '$budget' },
            spend: { $sum: '$spend' },
            leads: { $sum: '$leads' },
            prospects: { $sum: '$prospects' },
            clients: { $sum: '$clients' },
          } },
          { $sort: { spend: -1 } },
        ]).toArray(),
        campaignsCol().aggregate([
          { $match: { segment: { $ne: null } } },
          { $group: {
            _id: '$segment',
            leads: { $sum: '$leads' },
            spend: { $sum: '$spend' },
          } },
        ]).toArray(),
        campaignsCol().aggregate([
          { $group: {
            _id: { source: '$source', category: '$category' },
            leads: { $sum: '$leads' },
            spend: { $sum: '$spend' },
            prospects: { $sum: '$prospects' },
            clients: { $sum: '$clients' },
          } },
        ]).toArray(),
      ]);

      const t: any = totals[0] || {};
      const totalBudget = Number(t.totalBudget || 0);
      const totalSpend = Number(t.totalSpend || 0);
      const totalLeads = Number(t.totalLeads || 0);
      const totalProspects = Number(t.totalProspects || 0);
      const totalClients = Number(t.totalClients || 0);
      const cplBrut = totalLeads > 0 ? totalSpend / totalLeads : 0;
      const cacMoyen = totalClients > 0 ? totalSpend / totalClients : 0;

      res.json({
        // Legacy fields
        totalLeads,
        totalSpend,
        avgCPL: cplBrut,
        byChannel: byChannelAgg.map((c: any) => ({
          channel: c._id.channel,
          category: c._id.category,
          count: c.count,
          budget: c.budget,
          spend: c.spend,
          leads: c.leads,
          prospects: c.prospects,
          clients: c.clients,
          cpl: c.leads > 0 ? c.spend / c.leads : 0,
          cac: c.clients > 0 ? c.spend / c.clients : 0,
        })),
        // V11 enriched aliases
        totalBudget,
        budget_total: totalBudget,
        total_budget: totalBudget,
        depenses_total: totalSpend,
        total_spend: totalSpend,
        totalSpent: totalSpend,
        leads_total: totalLeads,
        total_leads: totalLeads,
        totalLeadsGenerated: totalLeads,
        totalProspects,
        total_prospects: totalProspects,
        totalClients,
        total_clients: totalClients,
        cplBrut,
        cpl_brut: cplBrut,
        avg_cpl: cplBrut,
        cplMoyenSegmente: 0, // computed client-side from bySegment
        cacMoyen,
        cac_moyen: cacMoyen,
        avg_cac: cacMoyen,
        avgCac: cacMoyen,
        budgetUsagePct: totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0,
        bySegment: bySegmentAgg.map((s: any) => ({
          segment: s._id,
          leads: s.leads,
          spend: s.spend,
          cpl: s.leads > 0 ? s.spend / s.leads : 0,
        })),
        bySource: bySourceAgg.map((s: any) => ({
          source: s._id.source,
          category: s._id.category,
          leads: s.leads,
          spend: s.spend,
          prospects: s.prospects,
          clients: s.clients,
          cpl: s.leads > 0 ? s.spend / s.leads : 0,
          cac: s.clients > 0 ? s.spend / s.clients : 0,
          conversionRate: s.prospects > 0 ? (s.clients / s.prospects) * 100 : 0,
        })),
        _source: 'live',
      });
      return;
    }

    // Fallback: legacy MarketingChannel model
    const [channels, totalLeadsAgg, totalSpendAgg, totalConvAgg] = await Promise.all([
      MarketingChannel.find().lean(),
      MarketingChannel.aggregate([{ $group: { _id: null, total: { $sum: '$leads' } } }]),
      MarketingChannel.aggregate([{ $group: { _id: null, total: { $sum: '$spend' } } }]),
      MarketingChannel.aggregate([{ $group: { _id: null, total: { $sum: '$conversions' } } }]),
    ]);
    const totalLeads = totalLeadsAgg[0]?.total || 0;
    const totalSpend = totalSpendAgg[0]?.total || 0;
    const totalConv = totalConvAgg[0]?.total || 0;
    res.json({
      totalLeads,
      totalSpend,
      avgCPL: totalLeads ? totalSpend / totalLeads : 0,
      total_conversions: totalConv,
      avg_cpl: totalLeads ? Number((totalSpend / totalLeads).toFixed(2)) : 0,
      avg_cpa: totalConv ? Number((totalSpend / totalConv).toFixed(2)) : 0,
      conversion_rate: totalLeads ? Number(((totalConv / totalLeads) * 100).toFixed(1)) : 0,
      active_channels: channels.filter((c) => c.active).length,
      byChannel: [],
      bySegment: [],
      bySource: [],
      _source: 'live-legacy',
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/marketing/channels — LEGACY (kept for backward-compat)
// ---------------------------------------------------------------------------
router.get(
  '/channels',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const channels = await MarketingChannel.find().lean();
    res.json(channels);
  })
);

// ---------------------------------------------------------------------------
// GET /api/bo/marketing/cpl — LEGACY (kept for backward-compat)
// ---------------------------------------------------------------------------
router.get(
  '/cpl',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const byChannel = await MarketingChannel.aggregate([
      { $group: { _id: '$platform', spend: { $sum: '$spend' }, leads: { $sum: '$leads' } } },
      { $sort: { spend: -1 } },
    ]);
    const result = byChannel.map((c: any) => ({
      platform: c._id,
      spend: c.spend,
      leads: c.leads,
      cpl: c.leads ? Number((c.spend / c.leads).toFixed(2)) : 0,
    }));
    const totalSpend = result.reduce((acc: number, r: any) => acc + r.spend, 0);
    const totalLeads = result.reduce((acc: number, r: any) => acc + r.leads, 0);
    res.json({
      by_channel: result,
      total_cpl: totalLeads ? Number((totalSpend / totalLeads).toFixed(2)) : 0,
    });
  })
);

export default router;
