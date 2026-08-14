import mongoose, { Schema, Document } from 'mongoose';

export interface ICompany extends Document {
  name: string;
  legalForm: 'SARL' | 'SA' | 'SAS' | 'EURL' | 'SNC' | 'Auto-entrepreneur';
  industry: string;
  email: string;
  phone: string;
  city: string;
  website?: string;
  contactName?: string;
  contactRole?: string;
  status: 'Actif' | 'Inactif' | 'Prospect' | 'Suspendu';
  contractType: 'Standard' | 'Premium' | 'Enterprise' | 'Trial';
  monthlyFee: number;
  createdAt: Date;
  updatedAt: Date;
}

const CompanySchema = new Schema<ICompany>(
  {
    name: { type: String, required: true, index: true },
    legalForm: { type: String, enum: ['SARL', 'SA', 'SAS', 'EURL', 'SNC', 'Auto-entrepreneur'], default: 'SARL' },
    industry: { type: String, default: 'Télémarketing' },
    email: { type: String, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    city: { type: String, default: 'Paris' },
    website: { type: String },
    contactName: { type: String },
    contactRole: { type: String },
    status: { type: String, enum: ['Actif', 'Inactif', 'Prospect', 'Suspendu'], default: 'Actif', index: true },
    contractType: { type: String, enum: ['Standard', 'Premium', 'Enterprise', 'Trial'], default: 'Standard' },
    monthlyFee: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export const Company = mongoose.model<ICompany>('Company', CompanySchema);
