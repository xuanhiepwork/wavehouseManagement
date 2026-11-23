// Router contract fixtures only. Production authentication is covered in
// postgres-only.test.cjs against the real createApp and its auth middleware.
const express = require('express');
const http = require('node:http');
const { Server } = require('socket.io');
const swaggerUi = require('swagger-ui-express');

function fixture(ready, options, legacy) {
    const app = express(), server = http.createServer(app), io = new Server(server);
    app.use(express.json());
    const docs = { openapi: '3.0.0', info: { title: 'Catalog test fixture', version: '1' }, components: { schemas: {} }, paths: {
        '/': { get: {} }, '/health': { get: {} },
    } };
    const routers = legacy ? null : require('../../dist/routes/catalog.postgres.routes');
    for (const [name, plural] of [['ingredient', 'ingredients'], ['product', 'products'], ['recipe', 'recipes']]) {
        const config = require(`../../dist/config/${name}.openapi`);
        const title = name[0].toUpperCase() + name.slice(1);
        const selected = legacy ? { paths: config[`${name}Paths`], schemas: config[`${name}Schemas`] }
            : config[`postgres${title}Documentation`]();
        Object.assign(docs.paths, selected.paths);
        Object.assign(docs.components.schemas, selected.schemas);
        const router = legacy ? require(`../../dist/routes/${name}.routes`)[`${name}Router`]
            : routers[`postgres${title}Router`](options[`postgres${title}s`] ?? {});
        app.use(`/api/${plural}`, router);
    }
    app.get('/api-docs.json', (_req, res) => res.json(docs));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(docs));
    app.get('/health', async (_req, res) => {
        let ok = false; try { ok = await ready(); } catch {}
        res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'unavailable' });
    });
    if (legacy) {
        const mongoose = require('mongoose');
        app.use((error, _req, res, next) => {
            if (error?.code === 11000) return res.status(409).json({ error: 'Ingredient code already exists' });
            if (error instanceof mongoose.Error.ValidationError || error instanceof mongoose.Error.CastError)
                return res.status(400).json({ error: 'Invalid request' });
            next(error);
        });
    }
    app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
    app.use(require('../../dist/middleware/errorHandler').errorHandler);
    return { app, server, io };
}
exports.createLegacyApp = (ready = () => true) => fixture(ready, {}, true);
exports.createApp = (ready = () => true, options = {}) => fixture(ready, options, false);
