import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityLog extends Document {
  type: 'login' | 'logout' | 'create' | 'update' | 'delete' | 'view' | 'ai_chat' | 'system';
  entity?: string;
  entityId?: string;
  description: string;
  userId?: mongoose.Types.ObjectId;
  userName?: string;
  meta?: Record<string, any>;
  createdAt: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    type: { type: String, enum: ['login', 'logout', 'create', 'update', 'delete', 'view', 'ai_chat', 'system'], default: 'system', index: true },
    entity: { type: String },
    entityId: { type: String },
    description: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    userName: { type: String },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ActivityLogSchema.index({ createdAt: -1 });

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);

export async function logActivity(entry: Partial<IActivityLog>): Promise<void> {
  try {
    await ActivityLog.create({
      type: entry.type || 'system',
      entity: entry.entity,
      entityId: entry.entityId,
      description: entry.description || '',
      userId: entry.userId,
      userName: entry.userName,
      meta: entry.meta,
    });
  } catch (e) {
    // best-effort
    console.warn('[activity] log failed:', (e as Error).message);
  }
}
