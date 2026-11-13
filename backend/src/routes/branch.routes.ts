import { Router } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import {
    UUID_RE,
    readBody,
    onlyKeys,
    prismaErrorCode,
    readPage,
} from '../utils/admin-api';

const branchSelect = {
    id: true,
    code: true,
    name: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
} as const;

export function createBranchRouter(prisma: PrismaClient) {
    const router = Router();

    // GET /api/branches?page=1
    router.get('/', async (req, res) => {
        const page = readPage(req.query.page);

        if (page === null) {
            res.status(400).json({ error: 'Invalid page' });
            return;
        }

        try {
            const [total, items] = await Promise.all([
                prisma.branch.count(),
                prisma.branch.findMany({
                    select: branchSelect,
                    orderBy: { code: 'asc' },
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, page, total });
        } catch {
            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    // GET /api/branches/:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({ error: 'Invalid branch ID' });
            return;
        }

        try {
            const branch = await prisma.branch.findUnique({
                where: { id },
                select: branchSelect,
            });

            if (!branch) {
                res.status(404).json({ error: 'Branch not found' });
                return;
            }

            res.json({ data: branch });
        } catch {
            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    // POST /api/branches
    router.post('/', async (req, res) => {
        const body = readBody(req.body);

        if (!body || !onlyKeys(body, ['code', 'name'])) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const code = typeof body.code === 'string'
            ? body.code.trim().toUpperCase()
            : '';

        const name = typeof body.name === 'string'
            ? body.name.trim()
            : '';

        if (
            !/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code) ||
            name.length < 1 ||
            name.length > 150
        ) {
            res.status(400).json({ error: 'Invalid branch data' });
            return;
        }

        try {
            const branch = await prisma.branch.create({
                data: { code, name },
                select: branchSelect,
            });

            res.status(201).json({ data: branch });
        } catch (error) {
            if (prismaErrorCode(error) === 'P2002') {
                res.status(409).json({ error: 'Branch code already exists' });
                return;
            }

            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    // PATCH /api/branches/:id
    router.patch('/:id', async (req, res) => {
        const id = req.params.id;
        const body = readBody(req.body);

        if (
            typeof id !== 'string' ||
            !UUID_RE.test(id) ||
            !body ||
            !onlyKeys(body, ['name', 'isActive'])
        ) {
            res.status(400).json({ error: 'Invalid request' });
            return;
        }

        const data: {
            name?: string;
            isActive?: boolean;
        } = {};

        if (body.name !== undefined) {
            if (typeof body.name !== 'string') {
                res.status(400).json({ error: 'Invalid name' });
                return;
            }

            const name = body.name.trim();

            if (!name || name.length > 150) {
                res.status(400).json({ error: 'Invalid name' });
                return;
            }

            data.name = name;
        }

        if (body.isActive !== undefined) {
            if (typeof body.isActive !== 'boolean') {
                res.status(400).json({ error: 'Invalid status' });
                return;
            }

            data.isActive = body.isActive;
        }

        if (Object.keys(data).length === 0) {
            res.status(400).json({ error: 'No changes provided' });
            return;
        }

        try {
            const branch = await prisma.branch.update({
                where: { id },
                data,
                select: branchSelect,
            });

            res.json({ data: branch });
        } catch (error) {
            if (prismaErrorCode(error) === 'P2025') {
                res.status(404).json({ error: 'Branch not found' });
                return;
            }

            res.status(503).json({ error: 'Database unavailable' });
        }
    });

    return router;
}