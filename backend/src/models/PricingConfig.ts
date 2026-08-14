import mongoose, { Schema, Document } from 'mongoose';

/**
 * PricingConfig — singleton document holding the entire pricing engine config.
 *
 * Stored in MongoDB collection `pricing_configs`.
 * Identified by `key === 'main'` so we always have exactly one config.
 *
 * Shape mirrors what the AdminTools page edits:
 *   - ppp.models[]        : PPR / PPF / PPI (min, cadence, mult, conv)
 *   - ppp.base            : base PPR HT (DT)
 *   - ppp.tva             : %
 *   - ppp.timbre          : DT
 *   - languesRares[]      : { category, credits, valueDT }
 *   - coefficients[]       : { group, label, value }
 *                          groups: 'langue','experience','activite','operation','ville','genre'
 *   - validityTranches[]  : { days, tranches }
 *   - preferentialPrices[]: { client, model, defaultCoef, newCoef, remise, type, orders }
 *
 * Note: the route handler in adminTools.ts uses `findOneAndUpdate({ key: 'main' }, ..., { upsert: true })`
 * directly — no need for a getSingleton() static method on the model.
 */

export interface PppModel { name: string; min: number; cadence: number; mult: number; conv: number; }
export interface LangueRareCat { category: string; credits: number; valueDT: number; }
export interface Coefficient { group: string; code?: string; label: string; value: number; }
export interface ValidityTranche { days: number; tranches: number; }
export interface PreferentialPrice {
  client: string;
  model: string;
  defaultCoef: number;
  newCoef: number;
  remise: number;
  type: 'À vie' | 'Ponctuelle';
  orders: string;
}

export interface IPricingConfig extends Document {
  key: string;
  ppp: {
    models: PppModel[];
    base: number;
    tva: number;
    timbre: number;
  };
  languesRares: {
    models: LangueRareCat[];
    tva: number;
    timbre: number;
  };
  coefficients: Coefficient[];
  validityTranches: ValidityTranche[];
  preferentialPrices: PreferentialPrice[];
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Sub-schemas (no generic — they're plain subdocs, not Documents)
// ---------------------------------------------------------------------------

const PppModelSchema = new Schema(
  {
    name:    { type: String, required: true },
    min:     { type: Number, default: 0 },
    cadence: { type: Number, default: 0 },
    mult:    { type: Number, default: 1 },
    conv:    { type: Number, default: 0 },
  },
  { _id: false }
);

const LangueRareSchema = new Schema(
  {
    category: { type: String, required: true },
    credits:  { type: Number, default: 0 },
    valueDT:  { type: Number, default: 0 },
  },
  { _id: false }
);

const CoefficientSchema = new Schema(
  {
    group: { type: String, required: true, index: true },
    code:  { type: String },
    label: { type: String, required: true },
    value: { type: Number, default: 1 },
  },
  { _id: false }
);

const ValidityTrancheSchema = new Schema(
  {
    days:     { type: Number, required: true },
    tranches: { type: Number, default: 1 },
  },
  { _id: false }
);

const PreferentialPriceSchema = new Schema(
  {
    client:       { type: String, required: true },
    model:        { type: String, default: 'PPP' },
    defaultCoef:  { type: Number, default: 1 },
    newCoef:      { type: Number, default: 1 },
    remise:       { type: Number, default: 0 },
    type:         { type: String, enum: ['À vie', 'Ponctuelle'], default: 'À vie' },
    orders:       { type: String, default: 'TOUTES' },
  },
  { _id: false }
);

// ---------------------------------------------------------------------------
// Main schema — NO statics block (the route uses findOneAndUpdate directly)
// ---------------------------------------------------------------------------

const PricingConfigSchema = new Schema<IPricingConfig>(
  {
    key: { type: String, required: true, unique: true, index: true, default: 'main' },
    ppp: {
      models:  { type: [PppModelSchema], default: [] },
      base:    { type: Number, default: 180 },
      tva:     { type: Number, default: 19 },
      timbre:  { type: Number, default: 1 },
    },
    languesRares: {
      models:  { type: [LangueRareSchema], default: [] },
      tva:     { type: Number, default: 19 },
      timbre:  { type: Number, default: 1 },
    },
    coefficients:       { type: [CoefficientSchema], default: [] },
    validityTranches:   { type: [ValidityTrancheSchema], default: [] },
    preferentialPrices: { type: [PreferentialPriceSchema], default: [] },
  },
  { timestamps: true }
);

// ---------------------------------------------------------------------------
// Export — single-arg generic is enough now (no custom statics)
// ---------------------------------------------------------------------------

export const PricingConfig = mongoose.model<IPricingConfig>(
  'PricingConfig',
  PricingConfigSchema
);

// ---------------------------------------------------------------------------
// Helper: get-or-create the singleton (plain function, not a model static)
// ---------------------------------------------------------------------------

export async function getPricingConfig(): Promise<IPricingConfig> {
  const doc = await PricingConfig.findOneAndUpdate(
    { key: 'main' },
    { $setOnInsert: { key: 'main' } },
    { upsert: true, new: true }
  );
  return doc as IPricingConfig;
}
