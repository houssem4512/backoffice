import mongoose, { Schema, Document } from 'mongoose';

/**
 * MatchingConfig — singleton document holding the lot-matching engine config.
 *
 * Stored in MongoDB collection `matching_configs`.
 * Identified by `key === 'main'`.
 *
 * Shape mirrors what the AdminTools page edits:
 *   - fixedCriteria[]      : always-applied criteria (Langue, Genre, ...)
 *   - levels[]             : 9 matching levels (N1..N9)
 *     each level:
 *       - level             : "N1".."N9"
 *       - niveauBadge       : 'badge-niveau1' | 'badge-niveau2' | 'badge-niveau3'
 *       - dateRange          : { badge: 'badge-info'|'badge-warning'|'badge-danger', label: '1-30j' | '30-60j' | '>60j' }
 *       - cells              : Record<columnKey, 'OK'|'KO'|'ANY'>
 *         columns: langue, genre, expGlobale, activite, expActivite, operation, expOperation, ville, modeTravail
 *
 * Note: the route handler in adminTools.ts uses `findOneAndUpdate({ key: 'main' }, ..., { upsert: true })`
 * directly — no need for a getSingleton() static method on the model.
 */

export type MatchingCell = 'OK' | 'KO' | 'ANY';
export type DateRangeLabel = '1-30j' | '30-60j' | '>60j';

export interface MatchingLevel {
  level: string;
  niveauBadge: 'badge-niveau1' | 'badge-niveau2' | 'badge-niveau3';
  dateRange: { badge: 'badge-info' | 'badge-warning' | 'badge-danger'; label: DateRangeLabel };
  cells: Record<string, MatchingCell>;
}

export interface IMatchingConfig extends Document {
  key: string;
  fixedCriteria: string[];
  levels: MatchingLevel[];
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Sub-schemas (no generic — they're plain subdocs, not Documents)
// ---------------------------------------------------------------------------

const DateRangeSchema = new Schema(
  {
    badge: { type: String, enum: ['badge-info', 'badge-warning', 'badge-danger'], default: 'badge-info' },
    label: { type: String, enum: ['1-30j', '30-60j', '>60j'], default: '1-30j' },
  },
  { _id: false }
);

const LevelSchema = new Schema(
  {
    level:       { type: String, required: true },
    niveauBadge: { type: String, enum: ['badge-niveau1', 'badge-niveau2', 'badge-niveau3'], default: 'badge-niveau1' },
    dateRange:   { type: DateRangeSchema, default: () => ({ badge: 'badge-info', label: '1-30j' }) },
    cells:       { type: Schema.Types.Mixed, default: {} },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema — NO statics block (the route uses findOneAndUpdate directly)
// ---------------------------------------------------------------------------

const MatchingConfigSchema = new Schema<IMatchingConfig>(
  {
    key:           { type: String, required: true, unique: true, index: true, default: 'main' },
    fixedCriteria: { type: [String], default: ['Langue', 'Genre', 'Expérience globale', 'Activité', 'Expérience Activité', 'Ville', 'Mode de travail'] },
    levels:        { type: [LevelSchema], default: [] },
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Export — single-arg generic is enough now (no custom statics)
// ---------------------------------------------------------------------------

export const MatchingConfig = mongoose.model<IMatchingConfig>(
  'MatchingConfig',
  MatchingConfigSchema
);

// ---------------------------------------------------------------------------
// Helper: get-or-create the singleton (plain function, not a model static)
// ---------------------------------------------------------------------------

export async function getMatchingConfig(): Promise<IMatchingConfig> {
  const doc = await MatchingConfig.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { upsert: true, new: true }
  );
  return doc as IMatchingConfig;
}
