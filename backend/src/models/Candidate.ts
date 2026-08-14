import mongoose, { Schema, Document } from 'mongoose';

export interface ICandidate extends Document {
  civility: 'M.' | 'Mme' | 'Mlle';
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  age?: number;
  city: string;
  position: string;
  activity: string;
  operation: string;
  languages: string[];
  experienceYears?: number;
  experiencePoste?: string;
  experienceActivite?: string;
  experienceOperation?: string;
  testLinguistique?: string;
  score?: number;
  livraisons?: number;
  source: 'Formulaire site' | 'Import Facebook' | 'Import LinkedIn' | 'Referral' | 'Manual';
  status: 'Disponible' | 'En process' | 'Livré' | 'Indisponible' | 'Désinscrit';
  lastActivityAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CandidateSchema = new Schema<ICandidate>(
  {
    civility: { type: String, enum: ['M.', 'Mme', 'Mlle'], default: 'M.' },
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },
    age: { type: Number, min: 16, max: 80 },
    city: { type: String, required: true, index: true },
    position: { type: String, default: 'Agent call center' },
    activity: { type: String, default: 'Télévente' },
    operation: { type: String, default: 'Inbound' },
    languages: [{ type: String }],
    experienceYears: { type: Number, default: 0 },
    experiencePoste: { type: String, default: '0-1 an' },
    experienceActivite: { type: String, default: '0-1 an' },
    experienceOperation: { type: String, default: '0-1 an' },
    testLinguistique: { type: String, default: 'Non passé' },
    score: { type: Number, default: 0, min: 0, max: 100 },
    livraisons: { type: Number, default: 0 },
    source: { type: String, default: 'Formulaire site' },
    status: { type: String, enum: ['Disponible', 'En process', 'Livré', 'Indisponible', 'Désinscrit'], default: 'Disponible', index: true },
    lastActivityAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

CandidateSchema.index({ firstName: 'text', lastName: 'text', email: 'text', city: 'text' });

export const Candidate = mongoose.model<ICandidate>('Candidate', CandidateSchema);
