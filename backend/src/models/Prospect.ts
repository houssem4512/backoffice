import mongoose, { Schema, Document } from 'mongoose';

export interface IProspect extends Document {
  name: string;
  email: string;
  phone: string;
  company?: string;
  city: string;
  source: 'Site web' | 'LinkedIn' | 'Referral' | 'Salon' | 'Cold email' | 'Facebook' | 'Manual';
  stage: 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
  value: number;
  currency: string;
  ownerId?: string;
  ownerName?: string;
  nextAction?: string;
  nextActionAt?: Date;
  closedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ProspectSchema = new Schema<IProspect>(
  {
    name: { type: String, required: true, index: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    company: { type: String },
    city: { type: String, default: 'Paris' },
    source: { type: String, default: 'Site web' },
    stage: { type: String, enum: ['new', 'qualified', 'proposal', 'negotiation', 'won', 'lost'], default: 'new', index: true },
    value: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User' },
    ownerName: { type: String },
    nextAction: { type: String },
    nextActionAt: { type: Date },
    closedAt: { type: Date },
    notes: { type: String },
  },
  { timestamps: true }
);

export const Prospect = mongoose.model<IProspect>('Prospect', ProspectSchema);
