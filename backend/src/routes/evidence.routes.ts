import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import { createEvidence, evidenceFailure, getEvidenceImage, listEvidence, parseTarget, parseUpload,
    type EvidenceActor } from '../services/evidence.service';

export function createEvidenceRouter(db: PrismaClient) {
    const router = Router();
    const actor = (res: Response) => res.locals.authUser as EvidenceActor;
    const failure = (res: Response, err: unknown) => {
        const result = evidenceFailure(err);
        res.status(result.status).json({ error: result.message });
    };
    router.use((_req, res, next) => {
        res.setHeader('Cache-Control', 'private, no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        next();
    });
    router.get('/:targetType/:targetId', async (req, res) => {
        try {
            const target = parseTarget(req.params.targetType, req.params.targetId);
            res.json({ items: await listEvidence(db, actor(res), target.type, target.targetId) });
        } catch (err) { failure(res, err); }
    });
    router.post('/:targetType/:targetId', async (req, res) => {
        try {
            const target = parseTarget(req.params.targetType, req.params.targetId);
            const input = parseUpload(req.body, target.type);
            const result = await createEvidence(db, actor(res), target.type, target.targetId, input);
            res.status(result.created ? 201 : 200).json({ data: result.data, replayed: !result.created });
        } catch (err) { failure(res, err); }
    });
    router.get('/:targetType/:targetId/:attachmentId/image', async (req, res) => {
        try {
            const target = parseTarget(req.params.targetType, req.params.targetId);
            const image = await getEvidenceImage(db, actor(res), target.type, target.targetId, req.params.attachmentId);
            res.setHeader('Content-Type', image.mimeType);
            res.setHeader('Content-Length', image.bytes.length);
            res.setHeader('Content-Security-Policy', "default-src 'none'");
            res.send(image.bytes);
        } catch (err) { failure(res, err); }
    });
    return router;
}
