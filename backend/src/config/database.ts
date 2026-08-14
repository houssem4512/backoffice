import mongoose from 'mongoose';

let connected = false;

export async function connectDB(): Promise<void> {
  if (connected) return;
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/callcentermatch';
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  connected = true;
  console.log('✅ MongoDB connected:', uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@'));
}

export async function closeDB(): Promise<void> {
  if (!connected) return;
  await mongoose.disconnect();
  connected = false;
}

export function isConnected(): boolean {
  return connected;
}
