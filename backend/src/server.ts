import { createApp } from './app';
import { catalogUsesPostgres, loadPostgresEnvironment } from './config/postgres';
import { createPrismaRuntime } from './db/prisma';
import { createPostgresIngredientService } from './services/ingredient.postgres.service';
import { createPostgresProductService } from './services/product.postgres.service';
import { createPostgresRecipeService } from './services/recipe.postgres.service';

export async function startServer() {
    loadPostgresEnvironment();
    const port = Number(process.env.PORT ?? 5000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    const host = process.env.HOST ?? '127.0.0.1';
    if (!['127.0.0.1', '0.0.0.0'].includes(host)) throw new Error('Unsupported backend listening host');
    catalogUsesPostgres();
    let runtime: ReturnType<typeof createPrismaRuntime> | undefined;
    let application: ReturnType<typeof createApp> | undefined;
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
            ...(runtime ? [Promise.resolve().then(() => runtime!.close())] : []),
        ]);
        if (socketFailed || results.some(result => result.status === 'rejected')) throw new Error('Backend cleanup failed');
    };
    try {
        runtime = createPrismaRuntime();
        application = createApp(() => runtime!.ready(), {
            authPrisma: runtime.client,
            postgresIngredients: createPostgresIngredientService(runtime.client),
            postgresProducts: createPostgresProductService(runtime.client),
            postgresRecipes: createPostgresRecipeService(runtime.client),
        });
        await runtime.connect();
        const { server } = application;
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            const listening = () => {
                server.off('error', reject);
                resolve();
            };
            server.listen(port, host, listening);
        });
    } catch (error) {
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
