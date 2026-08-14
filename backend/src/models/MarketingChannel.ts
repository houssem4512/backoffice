import mongoose, { Schema, Document } from 'mongoose';

export interface IMarketingChannel extends Document {
  name: string;
  platform: 'Facebook' | 'LinkedIn' | 'Google Ads' | 'Instagram' | 'TikTok' | 'Email' | 'Referral' | 'Direct';
  spend: number;
  leads: number;
  conversions: number;
  cpl: number; // cost per lead
  cpa: number; // cost per acquisition
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const MarketingChannelSchema = new Schema<IMarketingChannel>(
  {
    name: { type: String, required: true },
    platform: { type: String, enum: ['Facebook', 'LinkedIn', 'Google Ads', 'Instagram', 'TikTok', 'Email', 'Referral', 'Direct'], default: 'Facebook' },
    spend: { type: Number, default: 0 },
    leads: { type: Number, default: 0 },
    conversions: { type: Number, default: 0 },
    cpl: { type: Number, default: 0 },
    cpa: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const MarketingChannel = mongoose.model<IMarketingChannel>('MarketingChannel', MarketingChannelSchema);
