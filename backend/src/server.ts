import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createApp } from './app';
import { ingredientStore, productStore, catalogUsesPostgres, loadPostgresEnvironment } from './config/postgres';
import { createPrismaRuntime } from './db/prisma';
import { createPostgresIngredientService } from './services/ingredient.postgres.service';
import { createPostgresProductService } from './services/product.postgres.service';

dotenv.config();

export async function startServer() {
    const port = Number(process.env.PORT ?? 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    const postgres = catalogUsesPostgres();
    if (postgres) loadPostgresEnvironment();
    const runtime = postgres ? createPrismaRuntime() : undefined;
    const ready = runtime ? async () => mongoose.connection.readyState === 1 && await runtime.ready() : undefined;
    const { io, server } = runtime
        ? createApp(ready, {
            ...(ingredientStore() === 'postgres' ? { postgresIngredients: createPostgresIngredientService(runtime.client) } : {}),
            ...(productStore() === 'postgres' ? { postgresProducts: createPostgresProductService(runtime.client) } : {}),
        }) : createApp();
    try {
        if (runtime) await runtime.connect();
        await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wavehouse_db', {
            serverSelectionTimeoutMS: 10000,
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            const listening = () => {
                server.off('error', reject);
                resolve();
            };
            // The temporary mixed-store mode is loopback-only.
            if (runtime) server.listen(port, '127.0.0.1', listening);
            else server.listen(port, listening);
        });
    } catch (error) {
        await mongoose.disconnect();
        if (runtime) await runtime.close().catch(() => {});
        throw new Error('Backend database connection or startup failed');
    }
    console.log(`Backend listening on http://localhost:${port}`);
    let closing = false;
    const shutdown = () => {
        if (closing) return;
        closing = true;
        const timeout = setTimeout(() => process.exit(1), 10000);
        timeout.unref();
        io.close(() => {
            void Promise.all([mongoose.disconnect(), runtime?.close()]).then(() => {
                clearTimeout(timeout);
            }).catch((error: unknown) => {
                console.error('Shutdown failed');
                process.exitCode = 1;
            });
        });
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return server;
}

if (require.main === module) {
    void startServer().catch((error: unknown) => {
        console.error(error instanceof Error && error.message === 'PORT must be an integer between 1 and 65535'
            ? error.message : 'Backend startup failed: configuration or database unavailable');
        process.exitCode = 1;
    });
}
