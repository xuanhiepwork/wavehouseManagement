import { readFileSync } from 'node:fs';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresUrl } from '../config/postgres';

export function createPrismaRuntime(env: Record<string, string | undefined> = process.env) {
    // const adapter = new PrismaPg({
    //     connectionString: postgresUrl(env), max: 5, connectionTimeoutMillis: 5000,
    //     idleTimeoutMillis: 10000, statement_timeout: 5000
    // }, { onPoolError: () => { } });
    const cloud = env.CATALOG_POSTGRES_TARGET === 'aiven';

    if (cloud && !env.AIVEN_CA_PATH) {
        throw new Error('Aiven CA certificate path is missing');
    }

    const adapter = new PrismaPg({
        connectionString: postgresUrl(env),
        max: 5,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 10000,
        statement_timeout: 5000,
        ...(cloud ? {
            ssl: {
                ca: readFileSync(env.AIVEN_CA_PATH!, 'utf8'),
                rejectUnauthorized: true,
            },
        } : {}),
    }, { onPoolError: () => { } });
    const client = new PrismaClient({ adapter, log: [] });
    return {
        client,
        async connect() {
            try {
                await client.$connect();
                if (cloud) {
                    const rows = await client.$queryRaw<{
                        database: string;
                        role: string;
                        session: string;
                        tls: boolean;
                        elevated: boolean;
                    }[]>`
        SELECT
            current_database() AS database,
            current_user AS role,
            session_user AS session,
            (SELECT ssl FROM pg_stat_ssl
             WHERE pid = pg_backend_pid()) AS tls,
            (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole
             OR r.rolreplication OR r.rolbypassrls) AS elevated
        FROM pg_roles r
        WHERE r.rolname = current_user
    `;

                    const row = rows[0];

                    if (!row
                        || row.database !== 'wavehouse_dev'
                        || row.role !== 'wavehouse_app'
                        || row.session !== 'wavehouse_app'
                        || row.tls !== true
                        || row.elevated !== false) {
                        throw new Error('Aiven identity verification failed');
                    }

                    return;
                }
                const rows = await client.$queryRaw<{ database: string; role: string; session: string; owner: string; elevated: boolean; opposite_access: boolean; opposite_member: boolean; shadow_access: boolean }[]>`
                    SELECT current_database() AS database, current_user AS role, session_user AS session,
                        pg_get_userbyid(d.datdba) AS owner,
                        (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS elevated,
                        has_database_privilege(current_user, CASE WHEN current_database()='wavehouse_test' THEN 'wavehouse_dev' ELSE 'wavehouse_test' END, 'CONNECT') AS opposite_access,
                        pg_has_role(current_user, CASE WHEN current_database()='wavehouse_test' THEN 'wavehouse_dev' ELSE 'wavehouse_test' END, 'MEMBER') AS opposite_member,
                        has_database_privilege(current_user, 'wavehouse_shadow', 'CONNECT') AS shadow_access
                    FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`;
                const expected = env.NODE_ENV === 'test' ? 'wavehouse_test' : 'wavehouse_dev';
                const row = rows[0];
                if (!row || row.database !== expected || row.role !== expected || row.session !== expected
                    || row.owner !== expected || row.elevated || row.opposite_access || row.opposite_member
                    || (expected === 'wavehouse_test' && row.shadow_access)) throw new Error('Identity mismatch');
            } catch {
                await client.$disconnect().catch(() => { });
                throw new Error('PostgreSQL connection or role isolation verification failed');
            }
        },
        async ready() {
            try { await client.$queryRaw`SELECT 1`; return true; } catch { return false; }
        },
        async close() {
            try { await client.$disconnect(); } catch { throw new Error('PostgreSQL shutdown failed'); }
        },
    };
}
