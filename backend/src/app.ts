import type { PrismaClient } from './generated/prisma/client';
import { createAuthRouter } from './routes/auth.routes';
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { postgresIngredientRouter, postgresProductRouter, postgresRecipeRouter } from './routes/catalog.postgres.routes';
import { errorHandler } from './middleware/errorHandler';
import { postgresIngredientDocumentation } from './config/ingredient.openapi';
import { catalogUsesPostgres } from './config/postgres';
import type { createPostgresIngredientService } from './services/ingredient.postgres.service';
import { postgresProductDocumentation } from './config/product.openapi';
import type { createPostgresProductService } from './services/product.postgres.service';
import { postgresRecipeDocumentation } from './config/recipe.openapi';
import type { createPostgresRecipeService } from './services/recipe.postgres.service';
import { createAuthGuards } from './middleware/auth.middleware';
import { createBranchRouter } from './routes/branch.routes';
import { createUserRouter } from './routes/user.routes';
import { createInventoryRouter } from './routes/inventory.routes';
import { createGoodsReceiptRouter } from './routes/goods-receipt.routes';
import { createStockDocumentRouter } from './routes/stock-document.routes';
import { createShiftStockCountRouter } from './routes/shift-stock-count.routes';
import { createRestockRecommendationRouter } from './routes/restock-recommendation.routes';
import { createTransferReceiptRouter } from './routes/transfer-receipt.routes';
import { createSalesReportRouter } from './routes/sales-report.routes';
import { createDashboardRouter } from './routes/dashboard.routes';
import { createAreasRouter } from './routes/areas.routes';
import { createSchedulingRouter } from './routes/scheduling.routes';
import { createKitchenRouter } from './routes/kitchen.routes';
import { createDistributionRouter } from './routes/distribution.routes';
import { createKitchenPlanningRouter } from './routes/kitchen-planning.routes';
import { createRestockApprovalRouter } from './routes/restock-approval.routes';
import { createDeliveryDiscrepancyRouter } from './routes/delivery-discrepancy.routes';
import { createDeliveryReconciliationRouter } from './routes/delivery-reconciliation.routes';
import { createStockWriteOffRouter } from './routes/stock-writeoff.routes';
import { createStockAuditRouter } from './routes/stock-audit.routes';
import { createOperationalBranchRouter } from './routes/operational-branches.routes';

// Explicit paths keep documentation working after TypeScript sources are compiled.
const apiDocs = {
    openapi: '3.0.0',
    info: { title: 'WaveHouse Management API Docs', version: '1.0.0' },
    components: { schemas: {} },
    paths: {
        '/': { get: { summary: 'Server status', responses: { '200': { description: 'Server is running' } } } },
        '/health': {
            get: {
                summary: 'Database readiness', responses: {
                    '200': { description: 'Database is connected' },
                    '503': { description: 'Database is unavailable' },
                }
            }
        },
    },
};

export function createApp(isDatabaseReady: () => boolean | Promise<boolean> = () => false,
    options: {
        postgresIngredients?: ReturnType<typeof createPostgresIngredientService>;
        postgresProducts?: ReturnType<typeof createPostgresProductService>;
        postgresRecipes?: ReturnType<typeof createPostgresRecipeService>;
        authPrisma?: PrismaClient;
    } = {}) {
    catalogUsesPostgres();
    if (!options.authPrisma) throw new Error('Prisma authentication dependency is required');
    if (!options.postgresIngredients) throw new Error('Ingredient implementation selection is incomplete');
    if (!options.postgresProducts) throw new Error('Product implementation selection is incomplete');
    if (!options.postgresRecipes) throw new Error('Recipe implementation selection is incomplete');
    const ingredientDocs = postgresIngredientDocumentation();
    const productDocs = postgresProductDocumentation();
    const recipeDocs = postgresRecipeDocumentation();
    const docs = {
        ...apiDocs,
        components: { schemas: { ...apiDocs.components.schemas, ...ingredientDocs.schemas, ...productDocs.schemas, ...recipeDocs.schemas } },
        paths: { ...apiDocs.paths, ...ingredientDocs.paths, ...productDocs.paths, ...recipeDocs.paths }
    };
    const app = express();
    const server = http.createServer(app);
    const origin = process.env.CORS_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) ?? '*';
    const io = new Server(server, { cors: { origin, methods: ['GET', 'POST'] } });
    app.use(cors({ origin }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.get('/api-docs.json', (_req, res) => { res.json(docs); });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(docs));
    app.get('/', (_req, res) => {
        res.json({ status: 'success', message: 'WaveHouse Backend Server is running', timestamp: new Date() });
    });
    app.get('/health', async (_req, res) => {
        let ready = false;
        try { ready = await isDatabaseReady(); } catch { /* Readiness failures are sanitized. */ }
        res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
    });
    if (options.authPrisma) {
        const sessions = new Map<string, {
            userId: string;
            expiresAt: number;
        }>();

        const guards = createAuthGuards(options.authPrisma, sessions);

        app.use('/api/auth', createAuthRouter(options.authPrisma, sessions));

        app.use(
            '/api/inventory',
            guards.requireAuth,
            createInventoryRouter(options.authPrisma)
        );

        const revokeUserSessions = (userId: string) => {
            for (const [token, session] of sessions) {
                if (session.userId === userId) {
                    sessions.delete(token);
                }
            }
        };

        app.use(
            '/api/branches',
            guards.requireAuth,
            guards.requireAdmin,
            createBranchRouter(options.authPrisma)
        );

        app.use(
            '/api/users',
            guards.requireAuth,
            guards.requireAdmin,
            createUserRouter(options.authPrisma, revokeUserSessions)
        );

        app.use(
            '/api/goods-receipts',
            guards.requireAuth,
            createGoodsReceiptRouter(options.authPrisma)
        );

        app.use(
            '/api/stock-issues',
            guards.requireAuth,
            createStockDocumentRouter(options.authPrisma, 'ISSUE')
        );

        app.use(
            '/api/stock-transfers',
            guards.requireAuth,
            createStockDocumentRouter(options.authPrisma, 'TRANSFER')
        );

        app.use('/api/transfer-receipts', guards.requireAuth, createTransferReceiptRouter(options.authPrisma));
        app.use('/api/sales-reports', guards.requireAuth, createSalesReportRouter(options.authPrisma));
        app.use('/api/dashboard', guards.requireAuth, createDashboardRouter(options.authPrisma));
        app.use('/api/areas', guards.requireAuth, createAreasRouter(options.authPrisma));
        app.use('/api/scheduling', guards.requireAuth, createSchedulingRouter(options.authPrisma));
        app.use('/api/kitchen', guards.requireAuth, createKitchenRouter(options.authPrisma));
        app.use('/api/distribution', guards.requireAuth, createDistributionRouter(options.authPrisma));
        app.use('/api/kitchen-planning', guards.requireAuth, createKitchenPlanningRouter(options.authPrisma));
        app.use('/api/restock-approval', guards.requireAuth, createRestockApprovalRouter(options.authPrisma));
        app.use('/api/delivery-discrepancies', guards.requireAuth, createDeliveryDiscrepancyRouter(options.authPrisma));
        app.use('/api/delivery-reconciliation', guards.requireAuth, createDeliveryReconciliationRouter(options.authPrisma));
        app.use('/api/stock-writeoffs', guards.requireAuth, createStockWriteOffRouter(options.authPrisma));
        app.use('/api/stock-audit', guards.requireAuth, createStockAuditRouter(options.authPrisma));
        app.use('/api/operational-branches', guards.requireAuth, createOperationalBranchRouter(options.authPrisma));

        app.use(
            '/api/shift-stock-counts',
            guards.requireAuth,
            createShiftStockCountRouter(options.authPrisma)
        );

        app.use(
            '/api/restock-planning',
            guards.requireAuth,
            guards.requireAdmin,
            createRestockRecommendationRouter(options.authPrisma)
        );

        for (const path of [
            '/api/ingredients',
            '/api/products',
            '/api/recipes',
        ]) {
            app.use(
                path,
                guards.requireAuth,
                guards.requireAdminForMutations
            );
        }
    }
    app.use('/api/ingredients', postgresIngredientRouter(options.postgresIngredients!));
    app.use('/api/products', postgresProductRouter(options.postgresProducts!));
    app.use('/api/recipes', postgresRecipeRouter(options.postgresRecipes!));
    io.on('connection', socket => {
        // Existing notification relay; persistence remains in authenticated inventory APIs.
        socket.on('update_inventory', (data: unknown) => { io.emit('inventory_changed', data); });
    });
    app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
    app.use(errorHandler);
    return { app, server, io };
}
