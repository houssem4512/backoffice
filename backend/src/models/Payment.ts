import mongoose, { Schema, Document } from 'mongoose';

export interface IPayment extends Document {
  reference: string;
  orderId?: mongoose.Types.ObjectId;
  orderRef?: string;
  companyId: mongoose.Types.ObjectId;
  companyName: string;
  amount: number;
  currency: string;
  method: 'Card' | 'Bank transfer' | 'SEPA' | 'PayPal' | 'Cheque' | 'Cash';
  status: 'Payé' | 'En attente' | 'En retard' | 'Partiel' | 'Annulé' | 'Remboursé';
  dueDate?: Date;
  paidAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    reference: { type: String, required: true, unique: true, index: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    orderRef: { type: String },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    companyName: { type: String, required: true },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: 'EUR' },
    method: { type: String, enum: ['Card', 'Bank transfer', 'SEPA', 'PayPal', 'Cheque', 'Cash'], default: 'Card' },
    status: { type: String, enum: ['Payé', 'En attente', 'En retard', 'Partiel', 'Annulé', 'Remboursé'], default: 'En attente', index: true },
    dueDate: { type: Date },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema);
