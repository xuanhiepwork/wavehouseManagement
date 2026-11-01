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
export function productStore(env: Environment = process.env): 'mongodb' | 'postgres' {
    const mode = env.CATALOG_PRODUCT_STORE ?? 'mongodb';
    if (mode !== 'mongodb' && mode !== 'postgres') throw new Error('Unsupported Product persistence mode');
    if (mode === 'postgres' && !['development', 'test'].includes(env.NODE_ENV ?? '')) {
        throw new Error('PostgreSQL Products require explicit development or test environment');
    }
    return mode;
}
export function recipeStore(env: Environment = process.env): 'mongodb' | 'postgres' {
    const mode = env.CATALOG_RECIPE_STORE ?? 'mongodb';
    if (mode !== 'mongodb' && mode !== 'postgres') throw new Error('Unsupported Recipe persistence mode');
    if (mode === 'postgres') {
        if (!['development', 'test'].includes(env.NODE_ENV ?? '')) throw new Error('PostgreSQL Recipes require explicit development or test environment');
        if (ingredientStore(env) !== 'postgres' || productStore(env) !== 'postgres') {
            throw new Error('PostgreSQL Recipes require explicit PostgreSQL Ingredient and Product stores');
        }
    }
    return mode;
}
export function catalogUsesPostgres(env: Environment = process.env): boolean {
    // Evaluate every store, including invalid configurations; do not short-circuit validation.
    const ingredient = ingredientStore(env);
    const product = productStore(env);
    const recipe = recipeStore(env);
    return ingredient === 'postgres' || product === 'postgres' || recipe === 'postgres';
}
export function catalogUsesMongo(env: Environment = process.env): boolean {
    // Validate all selections before deriving dependencies, including Recipe prerequisites.
    const ingredient = ingredientStore(env);
    const product = productStore(env);
    const recipe = recipeStore(env);
    return ingredient === 'mongodb' || product === 'mongodb' || recipe === 'mongodb';
}
export function loadPostgresEnvironment() {
    config({ path: resolve(__dirname, '../../.env.postgres'), quiet: true });
}
export function postgresUrl(env: Environment = process.env): string {
    if (!catalogUsesPostgres(env)) throw new Error('PostgreSQL Catalog mode is not enabled');
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
