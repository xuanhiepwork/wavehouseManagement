import { config } from 'dotenv';
import { resolve } from 'node:path';

type Environment = Record<string, string | undefined>;
function store(key: string, env: Environment): 'postgres' {
    if (env[key] !== undefined && env[key] !== 'postgres') {
        throw new Error(`${key} must be postgres; MongoDB runtime is retired`);
    }
    return 'postgres';
}
export function ingredientStore(env: Environment = process.env): 'postgres' {
    return store('CATALOG_INGREDIENT_STORE', env);
}
export function productStore(env: Environment = process.env): 'postgres' {
    return store('CATALOG_PRODUCT_STORE', env);
}
export function recipeStore(env: Environment = process.env): 'postgres' {
    return store('CATALOG_RECIPE_STORE', env);
}
export function catalogUsesPostgres(env: Environment = process.env): boolean {
    ingredientStore(env); productStore(env); recipeStore(env);
    return true;
}
export function loadPostgresEnvironment() {
    // Exported variables win. Tests never inherit development credentials.
    if (process.env.NODE_ENV === 'test') return;
    for (const name of ['.env.local', '.env', '.env.postgres']) {
        config({ path: resolve(__dirname, '../..', name), quiet: true, override: false });
    }
}
export function postgresUrl(env: Environment = process.env): string {
    catalogUsesPostgres(env);
    if (!['development', 'test'].includes(env.NODE_ENV ?? '')) {
        throw new Error('PostgreSQL runtime requires explicit development or test environment');
    }
    const target = env.CATALOG_POSTGRES_TARGET ?? 'local';

    if (target !== 'local' && target !== 'aiven') {
        throw new Error('Unsupported PostgreSQL target');
    }

    if (target === 'aiven') {
        if (env.NODE_ENV !== 'development') {
            throw new Error('Aiven is only allowed in development mode');
        }

        if (!env.AIVEN_DB_PASSWORD) {
            throw new Error('Aiven database password is missing');
        }

        const url = new URL(
            'postgresql://wavehouse_app@do-an-he-thong-quan-ly-kho-do-an-2026.b.aivencloud.com:24631/wavehouse_dev'
        );

        url.password = env.AIVEN_DB_PASSWORD;
        return url.toString();
    }
    const value = env.NODE_ENV === 'test' ? env.TEST_DATABASE_URL : env.DATABASE_URL;
    const database = env.NODE_ENV === 'test' ? 'wavehouse_test' : 'wavehouse_dev';
    let url: URL;
    try { url = new URL(value ?? ''); } catch { throw new Error('Local PostgreSQL configuration is missing or invalid'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1'
        || url.port !== '5433' || url.pathname !== `/${database}` || url.username !== database
        || !url.password || url.hash || (env.NODE_ENV === 'test' && url.search)
        || [...url.searchParams].some(([key, item]) => key !== 'schema' || item !== 'public')) {
        throw new Error('PostgreSQL Ingredients require the approved local database and matching role');
    }
    return value!;
}
