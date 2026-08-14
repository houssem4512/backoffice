import { Router } from 'express';
import mongoose from 'mongoose';
import { PricingConfig } from '../models/PricingConfig';
import { MatchingConfig } from '../models/MatchingConfig';
import { FacebookImport } from '../models/FacebookImport';
import { Candidate } from '../models/Candidate';
import { authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

type ImportRow = {
  nom?: string; prenom?: string; email?: string; tel?: string;
  ville?: string; langue?: string; experience?: string; raw?: Record<string, any>;
};

const router = Router();

// ============================================================================
// PRICING ENDPOINTS
// ============================================================================

/**
 * GET /api/bo/admin-tools/pricing
 * Returns the singleton pricing config. Auto-creates defaults if missing.
 */
router.get(
  '/pricing',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const cfg = await PricingConfig.findOne({ key: 'main' });
    res.json(cfg || { key: 'main', ppp: { models: [], base: 180, tva: 19, timbre: 1 }, languesRares: { models: [], tva: 19, timbre: 1 }, coefficients: [], validityTranches: [], preferentialPrices: [] });
  })
);

/**
 * PUT /api/bo/admin-tools/pricing
 * Body: full pricing config (ppp, languesRares, coefficients, validityTranches, preferentialPrices)
 * Uses upsert on key='main' so we always have exactly one doc.
 */
router.put(
  '/pricing',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body || {};
    const update = {
      key: 'main',
      ppp: body.ppp || { models: [], base: 180, tva: 19, timbre: 1 },
      languesRares: body.languesRares || { models: [], tva: 19, timbre: 1 },
      coefficients: Array.isArray(body.coefficients) ? body.coefficients : [],
      validityTranches: Array.isArray(body.validityTranches) ? body.validityTranches : [],
      preferentialPrices: Array.isArray(body.preferentialPrices) ? body.preferentialPrices : [],
    };
    const cfg = await PricingConfig.findOneAndUpdate(
      { key: 'main' },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(cfg);
  })
);

/**
 * PUT /api/bo/admin-tools/pricing/ppp
 * Body: { models: PppModel[], base, tva, timbre }
 */
router.put(
  '/pricing/ppp',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { models, base, tva, timbre } = req.body || {};
    const cfg = await PricingConfig.findOneAndUpdate(
      { key: 'main' },
      { $set: { 'ppp.models': models || [], 'ppp.base': base ?? 180, 'ppp.tva': tva ?? 19, 'ppp.timbre': timbre ?? 1 } },
      { upsert: true, new: true }
    );
    res.json(cfg);
  })
);

/**
 * PUT /api/bo/admin-tools/pricing/coefficients
 * Body: { coefficients: Coefficient[] }
 */
router.put(
  '/pricing/coefficients',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const coefficients = Array.isArray(req.body?.coefficients) ? req.body.coefficients : [];
    const cfg = await PricingConfig.findOneAndUpdate(
      { key: 'main' },
      { $set: { coefficients } },
      { upsert: true, new: true }
    );
    res.json(cfg);
  })
);

/**
 * PUT /api/bo/admin-tools/pricing/validity
 * Body: { validityTranches: ValidityTranche[] }
 */
router.put(
  '/pricing/validity',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const validityTranches = Array.isArray(req.body?.validityTranches) ? req.body.validityTranches : [];
    const cfg = await PricingConfig.findOneAndUpdate(
      { key: 'main' },
      { $set: { validityTranches } },
      { upsert: true, new: true }
    );
    res.json(cfg);
  })
);

/**
 * GET /api/bo/admin-tools/pricing/preferential
 * Returns the preferential prices list.
 */
router.get(
  '/pricing/preferential',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const cfg = await PricingConfig.findOne({ key: 'main' });
    res.json(cfg?.preferentialPrices || []);
  })
);

/**
 * POST /api/bo/admin-tools/pricing/preferential
 * Body: PreferentialPrice
 */
router.post(
  '/pricing/preferential',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const newItem = req.body || {};
    const cfg = await PricingConfig.findOneAndUpdate(
      { key: 'main' },
      { $push: { preferentialPrices: newItem } },
      { upsert: true, new: true }
    );
    res.json(cfg.preferentialPrices[cfg.preferentialPrices.length - 1]);
  })
);

/**
 * PUT /api/bo/admin-tools/pricing/preferential/:index
 * Body: PreferentialPrice
 * Note: uses array index (0-based) — frontend doesn't have _id because subdocs have _id:false
 */
router.put(
  '/pricing/preferential/:index',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const idx = parseInt(req.params.index, 10);
    const newItem = req.body || {};
    const cfg = await PricingConfig.findOne({ key: 'main' });
    if (!cfg) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    if (idx < 0 || idx >= cfg.preferentialPrices.length) {
      res.status(404).json({ error: 'Preferential price not found at index ' + idx });
      return;
    }
    cfg.preferentialPrices[idx] = newItem as any;
    await cfg.save();
    res.json(cfg.preferentialPrices[idx]);
  })
);

/**
 * DELETE /api/bo/admin-tools/pricing/preferential/:index
 */
router.delete(
  '/pricing/preferential/:index',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const idx = parseInt(req.params.index, 10);
    const cfg = await PricingConfig.findOne({ key: 'main' });
    if (!cfg) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    if (idx < 0 || idx >= cfg.preferentialPrices.length) {
      res.status(404).json({ error: 'Preferential price not found at index ' + idx });
      return;
    }
    cfg.preferentialPrices.splice(idx, 1);
    await cfg.save();
    res.json({ ok: true });
  })
);

// ============================================================================
// MATCHING ENDPOINTS
// ============================================================================

/**
 * GET /api/bo/admin-tools/matching
 */
router.get(
  '/matching',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const cfg = await MatchingConfig.findOne({ key: 'main' });
    res.json(cfg || { key: 'main', fixedCriteria: [], levels: [] });
  })
);

/**
 * PUT /api/bo/admin-tools/matching
 * Body: { fixedCriteria: string[], levels: MatchingLevel[] }
 */
router.put(
  '/matching',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const body = req.body || {};
    const update = {
      key: 'main',
      fixedCriteria: Array.isArray(body.fixedCriteria) ? body.fixedCriteria : [],
      levels: Array.isArray(body.levels) ? body.levels : [],
    };
    const cfg = await MatchingConfig.findOneAndUpdate(
      { key: 'main' },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json(cfg);
  })
);

/**
 * PUT /api/bo/admin-tools/matching/levels/:level
 * Body: MatchingLevel (single level)
 */
router.put(
  '/matching/levels/:level',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const levelName = req.params.level;
    const newLevel = req.body || {};
    const cfg = await MatchingConfig.findOne({ key: 'main' });
    if (!cfg) {
      res.status(404).json({ error: 'Config not found' });
      return;
    }
    const idx = cfg.levels.findIndex((l: any) => l.level === levelName);
    if (idx === -1) {
      cfg.levels.push(newLevel);
    } else {
      cfg.levels[idx] = newLevel;
    }
    await cfg.save();
    res.json(cfg.levels.find((l: any) => l.level === levelName));
  })
);

/**
 * POST /api/bo/admin-tools/matching/simulate
 * Body: { lotSize: number, clientCriteria: { activity, language, city, ... } }
 *
 * Computes a real matching simulation against the `candidates` collection.
 * For each matching level N1..N9, count how many candidates match the level's
 * criteria AND the client criteria, then "select" min(matching, lotSize/N) per level.
 */
router.post(
  '/matching/simulate',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const lotSize = Math.max(parseInt(req.body?.lotSize, 10) || 50, 1);
    const clientCriteria = req.body?.clientCriteria || {};

    // Build base query from client criteria
    const baseQuery: any = { status: { $in: ['Disponible', 'En process'] } };
    if (clientCriteria.activity) baseQuery.activity = clientCriteria.activity;
    if (clientCriteria.city) baseQuery.city = clientCriteria.city;
    if (clientCriteria.language) baseQuery.languages = clientCriteria.language;

    // Load matching config
    const cfg = await MatchingConfig.findOne({ key: 'main' });
    const levels = cfg?.levels || [];

    // For each level, apply stricter criteria
    const simulation = [];
    let remaining = lotSize;
    for (const level of levels) {
      const q = { ...baseQuery };
      // Apply KO cells: criteria that MUST match strictly (treat as required)
      const cells = level.cells || {};
      // expOp KO means we require operation experience to be > 0-1 an
      if (cells.expOperation === 'KO') {
        q.experienceOperation = { $ne: '0-1 an' };
      }
      // For simulation purposes we approximate the matching level:
      // N1-N3 = candidates registered in last 30 days
      // N4-N6 = registered 30-60 days ago
      // N7-N9 = registered 60+ days ago
      const now = new Date();
      const range = level.dateRange?.label || '1-30j';
      if (range === '1-30j') {
        q.createdAt = { $gte: new Date(now.getTime() - 30 * 24 * 3600 * 1000) };
      } else if (range === '30-60j') {
        q.createdAt = {
          $gte: new Date(now.getTime() - 60 * 24 * 3600 * 1000),
          $lt: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
        };
      } else if (range === '>60j') {
        q.createdAt = { $lt: new Date(now.getTime() - 60 * 24 * 3600 * 1000) };
      }

      const dispo = await Candidate.countDocuments(q);
      const selected = Math.min(dispo, remaining);
      simulation.push({
        level: level.level,
        niveauBadge: level.niveauBadge,
        dispo,
        selected,
        reste: Math.max(dispo - selected, 0),
        pct: dispo > 0 ? Math.round((selected / dispo) * 100) : 0,
      });
      remaining = Math.max(remaining - selected, 0);
    }

    const totalDispo = simulation.reduce((a, s) => a + s.dispo, 0);
    const totalSelected = simulation.reduce((a, s) => a + s.selected, 0);

    res.json({
      lotSize,
      clientCriteria,
      simulation,
      totals: {
        dispo: totalDispo,
        selected: totalSelected,
        reste: totalDispo - totalSelected,
        pct: totalDispo > 0 ? Math.round((totalSelected / totalDispo) * 100) : 0,
      },
    });
  })
);

// ============================================================================
// FACEBOOK IMPORT ENDPOINTS
// ============================================================================

/**
 * GET /api/bo/admin-tools/imports
 * Returns the import history (without rows[] for performance).
 */
router.get(
  '/imports',
  authRequired,
  asyncHandler(async (_req: AuthRequest, res) => {
    const imports = await FacebookImport.find()
      .sort({ createdAt: -1 })
      .limit(50)
      .select('-rows')
      .lean();
    res.json({ data: imports, total: imports.length });
  })
);

/**
 * GET /api/bo/admin-tools/imports/:id
 * Returns the full import doc including rows[] (for preview).
 */
router.get(
  '/imports/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const imp = await FacebookImport.findById(id).lean();
    if (!imp) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    res.json(imp);
  })
);

/**
 * POST /api/bo/admin-tools/imports/upload
 * Body: { fileName, fileSize, fileType, content: string (CSV text or base64-encoded xlsx) }
 *
 * Parses CSV content (basic RFC4180-ish) and returns a preview doc with rows[].
 * For xlsx/xls we accept the file but return a friendly "Excel not yet supported" message.
 *
 * Returns: { _id, fileName, totalRows, preview: rows[] (first 100) }
 */
router.post(
  '/imports/upload',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const { fileName, fileSize, fileType, content } = req.body || {};
    if (!fileName || !content) {
      res.status(400).json({ error: 'fileName and content are required' });
      return;
    }
    const type = (fileType || 'csv').toLowerCase();

    let rows: ImportRow[] = [];
    if (type === 'csv') {
      rows = parseCsv(content);
    } else if (type === 'xlsx' || type === 'xls') {
      // Excel parsing requires the `xlsx` npm package on the backend.
      // For now, return a structured error so the frontend can show a helpful message.
      res.status(400).json({
        error: 'Excel parsing requires the xlsx package on the backend. Convertissez en CSV ou installez `xlsx`.',
        excelNotSupported: true,
      });
      return;
    } else {
      res.status(400).json({ error: 'Unsupported file type: ' + type });
      return;
    }

    const imp = await FacebookImport.create({
      fileName,
      fileSize: fileSize || content.length,
      fileType: type,
      status: 'pending',
      totalRows: rows.length,
      rows,
    });

    res.json({
      _id: imp._id,
      fileName: imp.fileName,
      fileType: imp.fileType,
      totalRows: imp.totalRows,
      preview: rows.slice(0, 100),
    });
  })
);

/**
 * POST /api/bo/admin-tools/imports/:id/validate
 * Body: { columnMapping?: Record<string,string>, markAsImported?: boolean }
 *
 * Inserts all rows into the `candidates` collection (skipping duplicates by email or phone).
 * Updates the import doc with importedCount / duplicateCount / errorCount.
 */
router.post(
  '/imports/:id/validate',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const imp = await FacebookImport.findById(id);
    if (!imp) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    const columnMapping = req.body?.columnMapping || {};
    const markAsImported = req.body?.markAsImported !== false;

    let importedCount = 0;
    let duplicateCount = 0;
    const errorDetails: string[] = [];

    for (let i = 0; i < imp.rows.length; i++) {
      const row = imp.rows[i] as any;
      const nom = row.nom || row.raw?.[columnMapping.nom] || '';
      const prenom = row.prenom || row.raw?.[columnMapping.prenom] || '';
      const email = (row.email || row.raw?.[columnMapping.email] || '').toLowerCase().trim();
      const tel = (row.tel || row.raw?.[columnMapping.tel] || '').trim();
      const ville = row.ville || row.raw?.[columnMapping.ville] || 'Tunis';
      const langue = row.langue || row.raw?.[columnMapping.langue] || 'Français';
      const experience = row.experience || row.raw?.[columnMapping.experience] || '0-1 an';

      if (!nom && !prenom && !email && !tel) {
        errorDetails.push(`Ligne ${i + 1}: vide`);
        continue;
      }

      // Duplicate check
      const dupQuery: any[] = [];
      if (email) dupQuery.push({ email });
      if (tel) dupQuery.push({ phone: tel });
      if (dupQuery.length > 0) {
        const exists = await Candidate.findOne({ $or: dupQuery });
        if (exists) {
          duplicateCount++;
          continue;
        }
      }

      // Split "Nom" into first/last if no prenom
      let firstName = prenom;
      let lastName = nom;
      if (!prenom && nom) {
        const parts = nom.trim().split(/\s+/);
        if (parts.length >= 2) {
          firstName = parts[0];
          lastName = parts.slice(1).join(' ');
        } else {
          firstName = nom;
          lastName = '';
        }
      }

      try {
        await Candidate.create({
          civility: 'M.',
          firstName: firstName || 'Inconnu',
          lastName: lastName || '',
          email: email || undefined,
          phone: tel || undefined,
          city: ville,
          position: 'Agent call center',
          activity: 'Télévente',
          operation: 'Inbound',
          languages: [langue],
          experienceYears: experience.includes('>=') || experience.includes('6') ? 1 : 0,
          experiencePoste: experience,
          experienceActivite: experience,
          experienceOperation: experience,
          source: 'Import Facebook',
          status: 'Disponible',
          lastActivityAt: new Date(),
        });
        importedCount++;
      } catch (e: any) {
        errorDetails.push(`Ligne ${i + 1}: ${e?.message || 'erreur inconnue'}`);
      }
    }

    imp.importedCount = importedCount;
    imp.duplicateCount = duplicateCount;
    imp.errorCount = errorDetails.length;
    imp.errorDetails = errorDetails;
    imp.columnMapping = columnMapping;
    if (markAsImported) {
      imp.status = 'completed';
      imp.importedAt = new Date();
    }
    await imp.save();

    res.json({
      _id: imp._id,
      status: imp.status,
      totalRows: imp.totalRows,
      importedCount,
      duplicateCount,
      errorCount: errorDetails.length,
      errorDetails,
    });
  })
);

/**
 * POST /api/bo/admin-tools/imports/:id/cancel
 */
router.post(
  '/imports/:id/cancel',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const imp = await FacebookImport.findByIdAndUpdate(
      id,
      { $set: { status: 'cancelled' } },
      { new: true }
    );
    if (!imp) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    res.json({ ok: true, status: imp.status });
  })
);

/**
 * DELETE /api/bo/admin-tools/imports/:id
 */
router.delete(
  '/imports/:id',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    await FacebookImport.findByIdAndDelete(id);
    res.json({ ok: true });
  })
);

// ============================================================================
// CSV PARSER — basic RFC4180-ish, supports quoted fields & commas
// ============================================================================

function parseCsv(text: string): ImportRow[] {
  const rows: ImportRow[] = [];
  const lines = splitCsvLines(text);
  if (lines.length === 0) return rows;

  // Detect separator: comma, semicolon, or tab
  const first = lines[0];
  let sep = ',';
  if (first.split(';').length > first.split(',').length) sep = ';';
  else if (first.split('\t').length > first.split(sep).length) sep = '\t';

  const headers = splitCsvRow(first, sep).map((h) => h.trim().toLowerCase());

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cells = splitCsvRow(line, sep);
    const raw: Record<string, any> = {};
    headers.forEach((h, idx) => { raw[h] = cells[idx] || ''; });

    const find = (...keys: string[]) => {
      for (const k of keys) {
        const v = raw[k];
        if (v && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    rows.push({
      nom: find('nom', 'name', 'fullname', 'full_name', 'nom_complet'),
      prenom: find('prenom', 'firstname', 'first_name', 'prénom'),
      email: find('email', 'mail', 'courriel'),
      tel: find('tel', 'telephone', 'phone', 'téléphone', 'mobile'),
      ville: find('ville', 'city', 'ville_'),
      langue: find('langue', 'language', 'lang'),
      experience: find('experience', 'exp', 'expérience', 'expérience_globale'),
      raw,
    });
  }
  return rows;
}

function splitCsvLines(text: string): string[] {
  // Respect quoted newlines
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      cur += c;
    } else if ((c === '\n' || c === '\r') && !inQuotes) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function splitCsvRow(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === sep && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

export default router;
