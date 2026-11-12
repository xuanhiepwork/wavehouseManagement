import { randomBytes } from 'node:crypto';
import { Router, type Request } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { createAuthService } from '../services/auth.service';

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 10;

export function createAuthRouter(prisma: PrismaClient) {
    const router = Router();
    const authService = createAuthService(prisma);

    const sessions = new Map<string, {
        userId: string;
        expiresAt: number;
    }>();

    const loginAttempts = new Map<string, {
        count: number;
        expiresAt: number;
    }>();

    function bearerToken(req: Request): string | null {
        const header = req.get('authorization') ?? '';
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
        return match?.[1] ?? null;
    }

    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        next();
    });

    // POST /api/auth/login
    router.post('/login', async (req, res) => {
        const email = req.body?.email;
        const password = req.body?.password;

        if (
            typeof email !== 'string' ||
            typeof password !== 'string' ||
            email.length === 0 ||
            email.length > 254 ||
            password.length === 0 ||
            password.length > 1024
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const key = req.ip ?? 'unknown';
        const now = Date.now();

        let attempt = loginAttempts.get(key);

        if (!attempt || attempt.expiresAt <= now) {
            attempt = {
                count: 0,
                expiresAt: now + LOGIN_WINDOW_MS,
            };
            loginAttempts.set(key, attempt);
        }

        if (attempt.count >= MAX_LOGIN_ATTEMPTS) {
            res.status(429).json({
                error: 'Too many login attempts',
            });
            return;
        }

        attempt.count++;

        try {
            const user = await authService.authenticate(email, password);

            if (!user) {
                res.status(401).json({
                    error: 'Invalid email or password',
                });
                return;
            }

            loginAttempts.delete(key);

            const token = randomBytes(32).toString('base64url');

            sessions.set(token, {
                userId: user.id,
                expiresAt: Date.now() + SESSION_DURATION_MS,
            });

            res.status(200).json({
                token,
                tokenType: 'Bearer',
                expiresIn: SESSION_DURATION_MS / 1000,
                user,
            });
        } catch {
            res.status(503).json({
                error: 'Authentication temporarily unavailable',
            });
        }
    });

    // GET /api/auth/me
    router.get('/me', async (req, res) => {
        const token = bearerToken(req);
        const session = token ? sessions.get(token) : undefined;

        if (!token || !session) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        if (session.expiresAt <= Date.now()) {
            sessions.delete(token);
            res.status(401).json({ error: 'Session expired' });
            return;
        }

        try {
            const user = await prisma.user.findUnique({
                where: { id: session.userId },
                select: {
                    id: true,
                    email: true,
                    displayName: true,
                    role: true,
                    branchId: true,
                    isActive: true,
                    branch: {
                        select: { isActive: true },
                    },
                },
            });

            if (
                !user ||
                !user.isActive ||
                (
                    user.role !== 'ADMIN' &&
                    (!user.branchId || !user.branch?.isActive)
                )
            ) {
                sessions.delete(token);
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            res.json({
                user: {
                    id: user.id,
                    email: user.email,
                    displayName: user.displayName,
                    role: user.role,
                    branchId: user.branchId,
                },
            });
        } catch {
            res.status(503).json({
                error: 'Authentication temporarily unavailable',
            });
        }
    });

    // POST /api/auth/logout
    router.post('/logout', (req, res) => {
        const token = bearerToken(req);

        if (!token || !sessions.has(token)) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }

        sessions.delete(token);
        res.status(204).end();
    });

    return router;
}