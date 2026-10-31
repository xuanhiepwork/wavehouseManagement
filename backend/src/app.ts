import express from 'express';
import http from 'node:http';
import { Server } from 'socket.io';
import mongoose from 'mongoose';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { ingredientRouter } from './routes/ingredient.routes';
import { errorHandler } from './middleware/errorHandler';
import { ingredientPaths, ingredientSchemas } from './config/ingredient.openapi';
import { productRouter } from './routes/product.routes';
import { productPaths, productSchemas } from './config/product.openapi';

// Explicit paths keep documentation working after TypeScript sources are compiled.
const apiDocs = {
    openapi: '3.0.0',
    info: { title: 'WaveHouse Management API Docs', version: '1.0.0' },
    components: { schemas: { ...ingredientSchemas, ...productSchemas } },
    paths: {
        ...ingredientPaths,
        ...productPaths,
        '/': { get: { summary: 'Server status', responses: { '200': { description: 'Server is running' } } } },
        '/health': { get: { summary: 'Database readiness', responses: {
            '200': { description: 'Database is connected' },
            '503': { description: 'Database is unavailable' },
        } } },
    },
};

export function createApp(isDatabaseReady = () => mongoose.connection.readyState === 1) {
    const app = express();
    const server = http.createServer(app);
    const origin = process.env.CORS_ORIGIN?.split(',').map(value => value.trim()).filter(Boolean) ?? '*';
    const io = new Server(server, { cors: { origin, methods: ['GET', 'POST'] } });
    app.use(cors({ origin }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.get('/api-docs.json', (_req, res) => { res.json(apiDocs); });
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(apiDocs));
    app.get('/', (_req, res) => {
        res.json({ status: 'success', message: 'WaveHouse Backend Server is running', timestamp: new Date() });
    });
    app.get('/health', (_req, res) => {
        const ready = isDatabaseReady();
        res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' });
    });
    app.use('/api/ingredients', ingredientRouter);
    app.use('/api/products', productRouter);
    io.on('connection', socket => {
        // Notification relay only; inventory persistence is not implemented yet.
        socket.on('update_inventory', (data: unknown) => { io.emit('inventory_changed', data); });
    });
    app.use((_req, res) => { res.status(404).json({ error: 'Not found' }); });
    app.use(errorHandler);
    return { app, server, io };
}
