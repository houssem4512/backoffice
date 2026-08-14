/**
 * ai.ts — v2 — AI assistant route with tool-calling support
 * ---------------------------------------------------------------------------
 * Endpoints:
 *   POST /api/bo/ai/chat          — main chat endpoint (uses tools)
 *   GET  /api/bo/ai/capabilities   — list available tools & sample questions
 * ---------------------------------------------------------------------------
 */
import { Router } from 'express';
import { chat } from '../services/aiService';
import { ActivityLog } from '../models/ActivityLog';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/bo/ai/chat
router.post(
  '/chat',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { messages, message } = req.body || {};
    const userMsg = (message || '').toString().trim();
    if (!userMsg) {
      return res.status(400).json({ error: 'Message vide' });
    }
    const history = Array.isArray(messages) ? messages : [];
    const result = await chat(history, userMsg);

    await ActivityLog.create({
      type: 'ai_chat',
      description: `Q: ${userMsg.slice(0, 200)}`,
      userId: req.user!.id as any,
      userName: req.user!.name,
      meta: {
        reply_length: result.response.length,
        actions: result.actions,
        tools_used: result.tools_used || [],
      },
    });

    res.json(result);
  })
);

// GET /api/bo/ai/capabilities — list what the assistant can do
router.get(
  '/capabilities',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    res.json({
      tools: [
        { name: 'get_total_candidates', description: 'Nombre total de candidats', sample: 'Combien de candidats avons-nous ?' },
        { name: 'get_candidates_by_city', description: 'Candidats par ville tunisienne', sample: 'Combien de candidats à Tunis ?' },
        { name: 'get_top_cities', description: 'Top villes par candidats', sample: 'Top 5 villes par candidats' },
        { name: 'get_candidates_by_language', description: 'Candidats par langue', sample: 'Combien de candidats francophones ?' },
        { name: 'get_top_languages', description: 'Top langues demandées', sample: 'Top 5 langues demandées' },
        { name: 'get_candidates_by_status', description: 'Candidats par statut', sample: 'Combien de candidats livrés ?' },
        { name: 'get_candidates_by_source', description: 'Candidats par source', sample: 'Combien de candidats du formulaire ?' },
        { name: 'get_recent_candidates', description: 'Derniers candidats inscrits', sample: 'Derniers 5 candidats' },
        { name: 'get_candidate_details', description: 'Fiche candidat par email/tél', sample: 'Trouve candidat sami@test.com' },
        { name: 'get_total_companies', description: 'Total sociétés', sample: 'Combien de sociétés ?' },
        { name: 'get_active_companies', description: 'Sociétés actives', sample: 'Combien de sociétés actives ?' },
        { name: 'get_total_orders', description: 'Total commandes', sample: 'Combien de commandes ?' },
        { name: 'get_orders_by_status', description: 'Commandes par statut', sample: 'Combien de commandes livrées ?' },
        { name: 'get_total_revenue', description: 'Revenu encaissé', sample: 'Quel est le chiffre d\'affaires ?' },
        { name: 'get_pending_payments', description: 'Paiements en attente', sample: 'Paiements en attente' },
        { name: 'get_late_payments', description: 'Paiements en retard', sample: 'Paiements en retard' },
        { name: 'get_total_prospects', description: 'Total prospects', sample: 'Combien de prospects ?' },
        { name: 'get_prospect_pipeline', description: 'Pipeline prospects', sample: 'Pipeline prospects' },
        { name: 'get_dashboard_summary', description: 'Vue d\'ensemble', sample: 'Donne-moi un résumé' },
      ],
      powered_by: process.env.GROQ_API_KEY ? 'Groq (llama-3.3-70b-versatile)' : 'Local smart router',
      note: process.env.GROQ_API_KEY
        ? 'Mode IA complet activé'
        : 'Mode local. Configurez GROQ_API_KEY dans backend/.env pour activer le mode IA complet.',
    });
  })
);

export default router;
