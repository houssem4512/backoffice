import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { ActivityLog } from '../models/ActivityLog';
import { signToken, authRequired, AuthRequest } from '../middleware/auth';
import { asyncHandler, ApiError } from '../middleware/errorHandler';

const router = Router();
// ===== DEMO LOGIN BYPASS (no database needed) =====
router.post('/demo-login', (_req, res) => {
  const token = signToken({
    id: 'demo-user-id',
    email: 'demo@ccm.ai',
    role: 'admin',
    name: 'Demo Admin',
  });
  res.json({
    token,
    user: {
      id: 'demo-user-id',
      email: 'demo@ccm.ai',
      name: 'Demo Admin',
      role: 'admin',
      status: 'active',
    },
  });
});

// POST /api/bo/auth/login
router.post(
  '/login',
  asyncHandler(async (req: AuthRequest, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) throw new ApiError(400, 'Email et mot de passe requis');

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) throw new ApiError(401, 'Email ou mot de passe incorrect');

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) throw new ApiError(401, 'Email ou mot de passe incorrect');
    if (user.status !== 'active') throw new ApiError(403, 'Compte désactivé');

    user.lastLoginAt = new Date();
    await user.save();

    const token = signToken({ id: String(user._id), email: user.email, role: user.role, name: user.name });
    await ActivityLog.create({
      type: 'login',
      description: `${user.email} s'est connecté`,
      userId: user._id,
      userName: user.name,
    });

    res.json({
      token,
      user: {
        id: String(user._id),
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
      },
    });
  })
);

// GET /api/bo/auth/me
router.get(
  '/me',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    const user = await User.findById(req.user!.id);
    if (!user) throw new ApiError(404, 'Utilisateur introuvable');
    res.json({
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
    });
  })
);

// POST /api/bo/auth/logout
router.post(
  '/logout',
  authRequired,
  asyncHandler(async (req: AuthRequest, res) => {
    await ActivityLog.create({
      type: 'logout',
      description: `${req.user!.email} s'est déconnecté`,
      userId: (req.user!.id as any),
      userName: req.user!.name,
    });
    res.json({ success: true });
  })
);

export default router;
