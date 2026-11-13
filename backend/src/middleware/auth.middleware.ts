
import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client';

type Session = {
    userId: string;
    expiresAt: number;
};

export function createAuthGuards(
    prisma: PrismaClient,
    sessions: Map<string, Session>
) {
    const requireAuth: RequestHandler = async (req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');

        const authorization = req.get('authorization') ?? '';
        const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization)?.[1];
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
                    role: true,
                    branchId: true,
                    isActive: true,
                    branch: { select: { isActive: true } },
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

            res.locals.authUser = {
                id: user.id,
                role: user.role,
                branchId: user.branchId,
            };

            next();
        } catch {
            res.status(503).json({
                error: 'Authentication temporarily unavailable',
            });
        }
    };

    const requireAdminForMutations: RequestHandler = (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            next();
            return;
        }

        if (res.locals.authUser?.role !== 'ADMIN') {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        next();
    };

    return { requireAuth, requireAdminForMutations };
}
