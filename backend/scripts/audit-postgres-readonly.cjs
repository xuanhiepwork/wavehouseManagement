// No migration, seed, GRANT, fixture insertion, row locking or data repair.
const { loadPostgresEnvironment } = require('../dist/config/postgres');
const { createPrismaRuntime } = require('../dist/db/prisma');
const { verifyRecipeFoundation } = require('../dist/services/recipe.postgres.service');

async function main() {
    loadPostgresEnvironment();
    const runtime = createPrismaRuntime({ ...process.env, POSTGRES_READ_ONLY: 'true' });
    try {
        await runtime.connect();
        await runtime.client.$transaction(async tx => {
            const identity = await tx.$queryRaw`SELECT current_database() AS database, current_user AS role,
                current_setting('transaction_read_only') AS read_only,
                (SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS tls`;
            console.log(JSON.stringify({ identity }));
            const tables = await tx.$queryRaw`SELECT c.relname AS name, c.relrowsecurity AS rls,
                has_table_privilege(current_user,c.oid,'SELECT') AS can_select,
                has_table_privilege(current_user,c.oid,'INSERT') AS can_insert,
                has_table_privilege(current_user,c.oid,'UPDATE') AS can_update,
                has_table_privilege(current_user,c.oid,'DELETE') AS can_delete,
                has_any_column_privilege(current_user,c.oid,'SELECT') AS column_select
                FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`;
            for (const table of tables) {
                // Identifiers come only from metadata and are restricted before interpolation.
                const count = table.can_select && /^[a-z_]+$/.test(table.name)
                    ? Number((await tx.$queryRawUnsafe(`SELECT count(*) AS total FROM public."${table.name}"`))[0].total)
                    : null;
                console.log(JSON.stringify({ ...table, count }));
            }
            await verifyRecipeFoundation(tx);
            console.log('Recipe constraints, indexes, triggers and numeric foundation verified (read-only).');
        }, { isolationLevel: 'RepeatableRead', timeout: 30000 });
    } finally { await runtime.close(); }
}
main().catch(() => { console.error('Read-only PostgreSQL audit failed; connection details omitted.'); process.exitCode = 1; });
