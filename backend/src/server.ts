import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { createApp } from './app';
import { ingredientStore, productStore, recipeStore, catalogUsesPostgres, catalogUsesMongo, loadPostgresEnvironment } from './config/postgres';
import { createPrismaRuntime } from './db/prisma';
import { createPostgresIngredientService } from './services/ingredient.postgres.service';
import { createPostgresProductService } from './services/product.postgres.service';
import { createPostgresRecipeService } from './services/recipe.postgres.service';

dotenv.config();

export async function startServer() {
    const port = Number(process.env.PORT ?? 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    const postgres = catalogUsesPostgres();
    if (postgres) loadPostgresEnvironment();
    // Revalidate after environment loading, before allocating any resources.
    const usesPostgres = catalogUsesPostgres();
    const usesMongo = catalogUsesMongo();
    let runtime: ReturnType<typeof createPrismaRuntime> | undefined;
    let application: ReturnType<typeof createApp> | undefined;
    let mongoAttempted = false;
    const cleanup = async () => {
        let socketFailed = false;
        if (application) {
            try {
                await new Promise<void>((resolve, reject) => Promise.resolve(application!.io.close(error => {
                    if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
                    else resolve();
                })).catch(reject));
            } catch { socketFailed = true; }
        }
        // Promise callbacks also contain synchronous driver failures, so every cleanup is attempted.
        const results = await Promise.allSettled([
            ...(mongoAttempted ? [Promise.resolve().then(() => mongoose.disconnect())] : []),
            ...(runtime ? [Promise.resolve().then(() => runtime!.close())] : []),
        ]);
        if (socketFailed || results.some(result => result.status === 'rejected')) throw new Error('Backend cleanup failed');
    };
    try {
        runtime = usesPostgres ? createPrismaRuntime() : undefined;
        const ready = async () => (!usesMongo || mongoose.connection.readyState === 1)
            && (!runtime || await runtime.ready());
        application = createApp(ready, runtime ? {
            authPrisma: runtime.client,
            ...(ingredientStore() === 'postgres' ? { postgresIngredients: createPostgresIngredientService(runtime.client) } : {}),
            ...(productStore() === 'postgres' ? { postgresProducts: createPostgresProductService(runtime.client) } : {}),
            ...(recipeStore() === 'postgres' ? { postgresRecipes: createPostgresRecipeService(runtime.client) } : {}),
        } : {});
        if (runtime) await runtime.connect();
        if (usesMongo) {
            mongoAttempted = true;
            await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/wavehouse_db', {
                serverSelectionTimeoutMS: 10000,
            });
        }
        const { server } = application;
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            const listening = () => {
                server.off('error', reject);
                resolve();
            };
            if (usesPostgres) server.listen(port, '127.0.0.1', listening);
            else server.listen(port, listening);
        });
    } catch (error) {
        console.error(
            'STARTUP DIAGNOSTIC:',
            error instanceof Error ? error.message : 'Unknown startup error'
        );

        await cleanup().catch(() => { });
        throw new Error('Backend database connection or startup failed');
    }
    const { server } = application;
    console.log(`Backend listening on http://localhost:${port}`);
    let closing = false;
    const shutdown = () => {
        if (closing) return;
        closing = true;
        const timeout = setTimeout(() => process.exit(1), 10000);
        timeout.unref();
        void cleanup().then(() => {
            clearTimeout(timeout);
        }).catch(() => {
            console.error('Shutdown failed');
            process.exitCode = 1;
        }).finally(() => {
            process.removeListener('SIGINT', shutdown);
            process.removeListener('SIGTERM', shutdown);
        });
    };
    // Keep both handlers installed while closing so repeated signals share the same shutdown.
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    return server;
}

if (require.main === module) {
    void startServer().catch((error: unknown) => {
        console.error(error instanceof Error && error.message === 'PORT must be an integer between 1 and 65535'
            ? error.message : 'Backend startup failed: configuration or database unavailable');
        process.exitCode = 1;
    });
}