import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { hashPassword } from '../services/password.service';
import {
    UUID_RE,
    readBody,
    onlyKeys,
    prismaErrorCode,
    readPage,
} from '../utils/admin-api';

type ManagedRole = 'STAFF' | 'BRANCH_MANAGER';

const userSelect = {
    id: true,
    email: true,
    displayName: true,
    role: true,
    branchId: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
} as const;

function validPassword(value: unknown): value is string {
    return typeof value === 'string' &&
        value.length >= 12 &&
        value.length <= 128;
}

function managedRole(value: unknown): value is ManagedRole {
    return value === 'STAFF' || value === 'BRANCH_MANAGER';
}

export function createUserRouter(
    prisma: PrismaClient,
    revokeUserSessions: (userId: string) => void
) {
    const router = Router();

    // GET /api/users?page=1
    router.get('/', async (req, res) => {
        const page = readPage(req.query.page);

        if (page === null) {
            res.status(400).json({ error: 'Invalid page' });
            return;
        }

        try {
            const [total, items] = await Promise.all([
                prisma.user.count(),
                prisma.user.findMany({
                    select: userSelect,
                    orderBy: { createdAt: 'desc' },
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, page, total });
        } catch {
            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    // GET /api/users/:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid user ID' });
            return;
        }

        try {
            const user = await prisma.user.findUnique({
                where: { id },
                select: userSelect,
            });

            if (!user) {
                res.status(404).json({ error: 'User not found' });
                return;
            }

            res.json({ data: user });
        } catch {
            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    // POST /api/users
    router.post('/', async (req, res) => {
        const body = readBody(req.body);

        if (
            !body ||
            !onlyKeys(body, [
                'email',
                'displayName',
                'password',
                'role',
                'branchId',
            ])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const email = typeof body.email === 'string'
            ? body.email.trim().toLowerCase()
            : '';

        const displayName = typeof body.displayName === 'string'
            ? body.displayName.trim()
            : '';

        const password = body.password;
        const role = body.role;
        const branchId = body.branchId;

        if (
            email.length > 254 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !displayName ||
            displayName.length > 120 ||
            !validPassword(password) ||
            !managedRole(role) ||
            typeof branchId !== 'string' ||
            !UUID_RE.test(branchId)
        ) {
            res.status(400).json({ error: 'Invalid user data' });
            return;
        }

        try {
            const branch = await prisma.branch.findUnique({
                where: { id: branchId },
                select: { isActive: true },
            });

            if (!branch || !branch.isActive) {
                res.status(409).json({
                    error: 'Branch does not exist or is inactive',
                });
                return;
            }

            const passwordHash = await hashPassword(password);

            const user = await prisma.user.create({
                data: {
                    email,
                    displayName,
                    passwordHash,
                    role,
                    branchId,
                },
                select: userSelect,
            });

            res.status(201).json({ data: user });
        } catch (error) {
            if (prismaErrorCode(error) === 'P2002') {
                res.status(409).json({ error: 'Email already exists' });
                return;
            }

            res.status(503).json({ error: 'Unable to create user' });
        }
    });

    // PATCH /api/users/:id
    router.patch('/:id', async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            !onlyKeys(body, [
                'displayName',
                'role',
                'branchId',
                'isActive',
            ])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const data: {
            displayName?: string;
            role?: ManagedRole;
            branchId?: string;
            isActive?: boolean;
        } = {};

        if (body.displayName !== undefined) {
            if (typeof body.displayName !== 'string') {
                res.status(400).json({ error: 'Invalid display name' });
                return;
            }

            const name = body.displayName.trim();

            if (!name || name.length > 120) {
                res.status(400).json({ error: 'Invalid display name' });
                return;
            }

            data.displayName = name;
        }

        if (body.role !== undefined) {
            if (!managedRole(body.role)) {
                res.status(400).json({ error: 'Invalid role' });
                return;
            }

            data.role = body.role;
        }

        if (body.isActive !== undefined) {
            if (typeof body.isActive !== 'boolean') {
                res.status(400).json({ error: 'Invalid status' });
                return;
            }

            data.isActive = body.isActive;
        }

        const branchId = body.branchId;

        if (branchId !== undefined) {
            if (
                typeof branchId !== 'string' ||
                !UUID_RE.test(branchId)
            ) {
                res.status(400).json({ error: 'Invalid branch ID' });
                return;
            }

            data.branchId = branchId;
        }

        if (Object.keys(data).length === 0) {
            res.status(400).json({ error: 'No changes provided' });
            return;
        }

        try {
            if (data.branchId) {
                const branch = await prisma.branch.findUnique({
                    where: { id: data.branchId },
                    select: { isActive: true },
                });

                if (!branch || !branch.isActive) {
                    res.status(409).json({
                        error: 'Branch does not exist or is inactive',
                    });
                    return;
                }
            }

            // Never update an ADMIN account through staff management.
            const result = await prisma.user.updateMany({
                where: {
                    id,
                    role: { in: ['STAFF', 'BRANCH_MANAGER'] },
                },
                data,
            });

            if (result.count === 0) {
                res.status(404).json({
                    error: 'Managed user not found',
                });
                return;
            }
            revokeUserSessions(id);

            const user = await prisma.user.findUnique({
                where: { id },
                select: userSelect,
            });

            res.json({ data: user });
        } catch {
            res.status(503).json({ error: 'Unable to update user' });
        }
    });

    // POST /api/users/:id/reset-password
    router.post('/:id/reset-password', async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            !onlyKeys(body, ['password']) ||
            !validPassword(body.password)
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        try {
            const passwordHash = await hashPassword(body.password);

            const result = await prisma.user.updateMany({
                where: {
                    id,
                    role: { in: ['STAFF', 'BRANCH_MANAGER'] },
                },
                data: { passwordHash },
            });

            if (result.count === 0) {
                res.status(404).json({
                    error: 'Managed user not found',
                });
                return;
            }
            revokeUserSessions(id);

            res.status(204).end();
        } catch {
            res.status(503).json({
                error: 'Unable to reset password',
            });
        }
    });

    return router;
}