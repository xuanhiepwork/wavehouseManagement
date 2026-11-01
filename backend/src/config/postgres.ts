import { config } from 'dotenv';
import { resolve } from 'node:path';

type Environment = Record<string, string | undefined>;
export function ingredientStore(env: Environment = process.env): 'mongodb' | 'postgres' {
    const mode = env.CATALOG_INGREDIENT_STORE ?? 'mongodb';
    if (mode !== 'mongodb' && mode !== 'postgres') throw new Error('Unsupported Ingredient persistence mode');
    if (mode === 'postgres' && !['development', 'test'].includes(env.NODE_ENV ?? '')) {
        throw new Error('PostgreSQL Ingredients require explicit development or test environment');
    }
    return mode;
}
export function loadPostgresEnvironment() {
    config({ path: resolve(__dirname, '../../.env.postgres'), quiet: true });
}
export function postgresUrl(env: Environment = process.env): string {
    if (ingredientStore(env) !== 'postgres') throw new Error('PostgreSQL Ingredient mode is not enabled');
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
