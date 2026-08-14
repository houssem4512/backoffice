import mongoose, { Schema, Document } from 'mongoose';

/**
 * FacebookImport — historical record of each Facebook-leads import attempt.
 *
 * Stored in MongoDB collection `facebook_imports`.
 *
 * Lifecycle:
 *   1. User uploads a CSV/Excel file → backend parses → creates a 'preview' doc
 *      with status='pending' and rows[] = parsed leads.
 *   2. User reviews the preview + maps columns → POST /imports/:id/validate
 *      → backend inserts rows into `candidates` collection, updates status='completed'
 *      with imported/duplicates/errors counts.
 *   3. User can cancel → status='cancelled'.
 */

export interface ImportRow {
  nom?: string;
  prenom?: string;
  email?: string;
  tel?: string;
  ville?: string;
  langue?: string;
  experience?: string;
  raw?: Record<string, any>;
}

export interface IFacebookImport extends Document {
  fileName: string;
  fileSize: number;
  fileType: 'csv' | 'xlsx' | 'xls' | 'unknown';
  status: 'pending' | 'completed' | 'cancelled' | 'failed';
  totalRows: number;
  importedCount: number;
  duplicateCount: number;
  errorCount: number;
  rows: ImportRow[];
  columnMapping?: Record<string, string>;
  errorDetails?: string[];
  importedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ImportRowSchema = new Schema<ImportRow>(
  {
    nom:        { type: String },
    prenom:     { type: String },
    email:      { type: String },
    tel:        { type: String },
    ville:      { type: String },
    langue:     { type: String },
    experience: { type: String },
    raw:        { type: Schema.Types.Mixed },
  },
  { _id: false }
);

const FacebookImportSchema = new Schema<IFacebookImport>(
  {
    fileName:       { type: String, required: true },
    fileSize:       { type: Number, default: 0 },
    fileType:       { type: String, enum: ['csv', 'xlsx', 'xls', 'unknown'], default: 'unknown' },
    status:         { type: String, enum: ['pending', 'completed', 'cancelled', 'failed'], default: 'pending', index: true },
    totalRows:      { type: Number, default: 0 },
    importedCount:  { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    errorCount:     { type: Number, default: 0 },
    rows:           { type: [ImportRowSchema], default: [] },
    columnMapping:  { type: Schema.Types.Mixed },
    errorDetails:   { type: [String], default: [] },
    importedAt:     { type: Date },
  },
  { timestamps: true }
);

export const FacebookImport = mongoose.model<IFacebookImport>('FacebookImport', FacebookImportSchema);
