import type { PrismaClient } from './generated/prisma/client';
import { createAuthRouter } from './routes/auth.routes';
import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { ingredientRouter, postgresIngredientRouter } from './routes/ingredient.routes';
import { errorHandler } from './middleware/errorHandler';
import { ingredientPaths, ingredientSchemas, postgresIngredientDocumentation } from './config/ingredient.openapi';
import { ingredientStore, productStore, recipeStore } from './config/postgres';
import type { createPostgresIngredientService } from './services/ingredient.postgres.service';
import { productRouter, postgresProductRouter } from './routes/product.routes';
import { productPaths, productSchemas, postgresProductDocumentation } from './config/product.openapi';
import type { createPostgresProductService } from './services/product.postgres.service';
import { recipeRouter, postgresRecipeRouter } from './routes/recipe.routes';
import { recipePaths, recipeSchemas, postgresRecipeDocumentation } from './config/recipe.openapi';
import type { createPostgresRecipeService } from './services/recipe.postgres.service';
import { createAuthGuards } from './middleware/auth.middleware';
import { createBranchRouter } from './routes/branch.routes';
import { createUserRouter } from './routes/user.routes';
import { createInventoryRouter } from './routes/inventory.routes';

// Explicit paths keep documentation working after TypeScript sources are compiled.
const apiDocs = {
    openapi: '3.0.0',
    info: { title: 'WaveHouse Management API Docs', version: '1.0.0' },
    components: { schemas: { ...ingredientSchemas, ...productSchemas, ...recipeSchemas } },
    paths: {
        ...ingredientPaths,
        ...productPaths,
        ...recipePaths,
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

export function createApp(isDatabaseReady: () => boolean | Promise<boolean> = () => mongoose.connection.readyState === 1,
    options: {
        postgresIngredients?: ReturnType<typeof createPostgresIngredientService>;
        postgresProducts?: ReturnType<typeof createPostgresProductService>;
        postgresRecipes?: ReturnType<typeof createPostgresRecipeService>;
        authPrisma?: PrismaClient;
    } = {}) {
    const mode = ingredientStore();
    const products = productStore();
    const recipes = recipeStore();
    if ((mode === 'postgres') !== !!options.postgresIngredients) throw new Error('Ingredient implementation selection is incomplete');
    if ((products === 'postgres') !== !!options.postgresProducts) throw new Error('Product implementation selection is incomplete');
    if ((recipes === 'postgres') !== !!options.postgresRecipes) throw new Error('Recipe implementation selection is incomplete');
    const ingredientDocs = mode === 'postgres' ? postgresIngredientDocumentation() : { schemas: {}, paths: {} };
    const productDocs = products === 'postgres' ? postgresProductDocumentation() : { schemas: {}, paths: {} };
    const recipeDocs = recipes === 'postgres' ? postgresRecipeDocumentation() : { schemas: {}, paths: {} };
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
    app.use('/api/ingredients', options.postgresIngredients ? postgresIngredientRouter(options.postgresIngredients) : ingredientRouter);
    app.use('/api/products', options.postgresProducts ? postgresProductRouter(options.postgresProducts) : productRouter);
    app.use('/api/recipes', options.postgresRecipes ? postgresRecipeRouter(options.postgresRecipes) : recipeRouter);
    io.on('connection', socket => {
        // Notification relay only; inventory persistence is not implemented yet.
        socket.on('update_inventory', (data: unknown) => { io.emit('inventory_changed', data); });
    });
    app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
    app.use(errorHandler);
    return { app, server, io };
}
