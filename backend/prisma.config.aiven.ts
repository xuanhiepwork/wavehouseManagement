/// <reference types="node" />
import { resolve } from 'node:path';
import { defineConfig } from 'prisma/config';

const password = process.env.AIVEN_ADMIN_DB_PASSWORD;

if (!password) {
    throw new Error('Missing AIVEN_ADMIN_DB_PASSWORD');
}

const url = new URL(
    'postgresql://avnadmin@do-an-he-thong-quan-ly-kho-do-an-2026.b.aivencloud.com:24631/wavehouse_dev'
);

url.password = password;
url.searchParams.set('schema', 'public');
url.searchParams.set('sslmode', 'require');
// url.searchParams.set('sslcert', '../../ca.pem');
url.searchParams.set(
    'sslcert',
    resolve(__dirname, '../ca.pem').replace(/\\/g, '/')
);

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: url.toString(),
    },
});