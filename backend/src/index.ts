import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { connectDB } from './config/database';
import { errorHandler, notFound } from './middleware/errorHandler';

// Routes
import authRoutes from './routes/auth';
import dashboardRoutes from './routes/dashboard';
import candidateRoutes from './routes/candidates';
import candidateStatsRoutes from './routes/candidatesStats';
import companyRoutes from './routes/companies';
import prospectRoutes from './routes/prospects';
import orderRoutes from './routes/orders';
import paymentRoutes from './routes/payments';
import userRoutes from './routes/users';
import marketingRoutes from './routes/marketing';
import analyticsRoutes from './routes/analytics';
import aiRoutes from './routes/ai';
import adminToolsRoutes from './routes/adminTools'; // NEW V12 — Pricing / Matching / Facebook imports

const app = express();
const PORT = process.env.PORT || 3200;

// Middleware
app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' })); // bumped from 10mb → 50mb for CSV uploads in Admin Tools

// Health check (no auth)
app.get('/api/bo/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: new Date().toISOString() } });
});

// API Routes (all require JWT auth — applied per-route in each router)
app.use('/api/bo/auth', authRoutes);
app.use('/api/bo/dashboard', dashboardRoutes);
app.use('/api/bo/candidates', candidateStatsRoutes); // v7: /stats (nested), /stats-by-ville (auto-discovery), /inspect — MUST be before candidateRoutes so its /stats wins
app.use('/api/bo/candidates', candidateRoutes);      // adds / (paginated list of candidates)
app.use('/api/bo/companies', companyRoutes);
app.use('/api/bo/prospects', prospectRoutes);
app.use('/api/bo/orders', orderRoutes);
app.use('/api/bo/payments', paymentRoutes);
app.use('/api/bo/users', userRoutes);
app.use('/api/bo/marketing', marketingRoutes);
app.use('/api/bo/analytics', analyticsRoutes);
app.use('/api/bo/ai', aiRoutes);
app.use('/api/bo/admin-tools', adminToolsRoutes); // NEW V12 — /pricing, /matching, /imports

// 404 + error handler
app.use(notFound);
app.use(errorHandler);

// Start
const start = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 CCM BackOffice API running on port ${PORT}`);
      console.log(`   CORS: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
      console.log(`   Groq AI: ${process.env.GROQ_API_KEY ? 'configured' : 'not configured (using local RAG stub)'}`);
      console.log(`   Admin Tools: /api/bo/admin-tools (pricing, matching, imports)`);
    });
  } catch (err) {
    console.error('❌ Failed to start:', err);
    process.exit(1);
  }
};

start();