import dotenv from 'dotenv';
dotenv.config();
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { connectDB } from '../config/database';

const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  role: { type: String, default: 'admin' },
  status: { type: String, default: 'active' },
  lastLoginAt: { type: Date },
}, { timestamps: true });
const User = mongoose.model('User', userSchema);

async function main() {
  await connectDB();
  const email = 'admin@ccm.ai';
  const password = 'admin123';
  const hash = await bcrypt.hash(password, 10);
  const existing = await User.findOne({ email });
  if (existing) {
    existing.password = hash;
    await existing.save();
    console.log(`✓ Updated: ${email} / ${password}`);
  } else {
    await User.create({ email, password: hash, name: 'Admin', role: 'admin', status: 'active' });
    console.log(`✓ Created: ${email} / ${password}`);
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch((err) => { console.error('❌', err?.message || err); process.exit(1); });