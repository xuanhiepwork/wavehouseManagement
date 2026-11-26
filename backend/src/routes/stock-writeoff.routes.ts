import { Router, type Response } from 'express';
import type { PrismaClient } from '../generated/prisma/client';
import type { DistributionActor } from '../services/distribution.service';
import { listWriteOffTargets, listWriteOffBalances, listWriteOffs, submitWriteOff,
    reviewWriteOff, writeOffFailure } from '../services/stock-writeoff.service';

export function createStockWriteOffRouter(db: PrismaClient) {
    const router = Router();
    const actor = (res: Response) => res.locals.authUser as DistributionActor;
    function failure(res: Response, err: unknown) {
        const info = writeOffFailure(err); res.status(info.status).json({ error: info.message });
    }
    router.get('/targets', async (req, res) => {
        try {
            if (Object.keys(req.query).length) return void res.status(400).json({error:'Không hỗ trợ bộ lọc này.'});
            res.setHeader('Cache-Control','no-store');
            res.json(await listWriteOffTargets(db,actor(res)));
        } catch(err){failure(res,err);}
    });
    router.get('/balances', async (req, res) => {
        try {
            if (Object.keys(req.query).some(x=>!['locationType','locationId'].includes(x)) ||
                (req.query.locationType!=='BRANCH' && req.query.locationType!=='WAREHOUSE') ||
                typeof req.query.locationId !== 'string') return void res.status(400).json({error:'Địa điểm không hợp lệ.'});
            res.setHeader('Cache-Control','no-store');
            res.json({items:await listWriteOffBalances(db,actor(res),req.query.locationType,req.query.locationId)});
        }catch(err){failure(res,err);}
    });
    router.get('/requests',async(req,res)=>{
        try {
            if (Object.keys(req.query).length) return void res.status(400).json({error:'Không hỗ trợ bộ lọc này.'});
            res.setHeader('Cache-Control','no-store');
            res.json({items:await listWriteOffs(db,actor(res))});
        }catch(err){failure(res,err);}
    });
    router.post('/requests',async(req,res)=>{
        try{res.status(201).json({data:await submitWriteOff(db,actor(res),req.body)});}
        catch(err){failure(res,err);}
    });
    router.post('/requests/:id/review',async(req,res)=>{
        try{res.json({data:await reviewWriteOff(db,actor(res),req.params.id,req.body)});}
        catch(err){failure(res,err);}
    });
    return router;
}
