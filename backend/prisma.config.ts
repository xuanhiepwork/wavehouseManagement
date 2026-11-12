import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '.env.postgres'), quiet: true });

function localUrl(value: string | undefined, shadow = false) {
    if (!value) return undefined;
    let target: URL;
    try {
        target = new URL(value);
    } catch {
        throw new Error('Invalid local PostgreSQL URL; connection details omitted.');
    }
    const database = target.pathname.slice(1);
    const role = target.username;
    const allowed = shadow
        ? database === 'wavehouse_shadow' && role === 'wavehouse_dev'
        : (database === 'wavehouse_dev' && role === 'wavehouse_dev')
            || (database === 'wavehouse_test' && role === 'wavehouse_test');
    if (!['postgres:', 'postgresql:'].includes(target.protocol)
        || target.hostname !== '127.0.0.1' || target.port !== '5433'
        || !allowed || !target.password || target.hash
        || [...target.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')) {
        throw new Error('Prisma requires the approved local database and matching role on 127.0.0.1:5433.');
    }
    return value;
}

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: { path: 'prisma/migrations' },
    datasource: {
        url: localUrl(process.env.DATABASE_URL),
        shadowDatabaseUrl: localUrl(process.env.SHADOW_DATABASE_URL, true),
    },
});
