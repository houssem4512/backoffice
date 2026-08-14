import mongoose, { Schema, Document } from 'mongoose';

export interface IOrder extends Document {
  reference: string;
  companyId: mongoose.Types.ObjectId;
  companyName: string;
  amount: number;
  currency: string;
  type: 'Recrutement' | 'Formation' | 'Abonnement' | 'Prestation' | 'Conseil';
  status: 'En attente' | 'Confirmée' | 'En cours' | 'Livrée' | 'Annulée' | 'En retard';
  deliveryDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    reference: { type: String, required: true, unique: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    companyName: { type: String, required: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    type: { type: String, enum: ['Recrutement', 'Formation', 'Abonnement', 'Prestation', 'Conseil'], default: 'Recrutement' },
    status: { type: String, enum: ['En attente', 'Confirmée', 'En cours', 'Livrée', 'Annulée', 'En retard'], default: 'En attente', index: true },
    deliveryDate: { type: Date },
  },
  { timestamps: true }
);

export const Order = mongoose.model<IOrder>('Order', OrderSchema);
