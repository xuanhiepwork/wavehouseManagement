const { Client } = require('pg');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function validateTestUrl(value) {
    if (!value?.trim()) throw new Error('TEST_DATABASE_URL is required; DATABASE_URL is never used as a fallback.');
    let target;
    try {
        target = new URL(value);
    } catch {
        throw new Error('Invalid TEST_DATABASE_URL; connection details omitted.');
    }
    if (!['postgres:', 'postgresql:'].includes(target.protocol)
        || target.hostname !== '127.0.0.1' || target.port !== '5433'
        || target.pathname !== '/wavehouse_test' || target.username !== 'wavehouse_test'
        || !target.password || target.search || target.hash) {
        throw new Error('Tests require wavehouse_test database and role on 127.0.0.1:5433, without URL parameters.');
    }
    return value;
}

async function connectTestDatabase(value) {
    const client = new Client({ connectionString: validateTestUrl(value), connectionTimeoutMillis: 5000 });
    try {
        await client.connect();
        const { rows: [identity] } = await client.query(`
            SELECT current_database() AS database, current_user AS role, session_user AS session_role,
                r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
                pg_has_role(current_user, 'wavehouse_dev', 'MEMBER') AS dev_member,
                has_database_privilege(current_user, 'wavehouse_dev', 'CONNECT') AS dev_access,
                has_database_privilege(current_user, 'wavehouse_shadow', 'CONNECT') AS shadow_access,
                pg_get_userbyid(d.datdba) AS owner
            FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
            WHERE r.rolname = current_user
        `);
        if (!identity || identity.database !== 'wavehouse_test' || identity.role !== 'wavehouse_test'
            || identity.session_role !== 'wavehouse_test' || identity.owner !== 'wavehouse_test'
            || ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls',
                'dev_member', 'dev_access', 'shadow_access'].some(key => identity[key])) {
            throw new Error('Test database identity or role isolation check failed.');
        }
        return client;
    } catch {
        await client.end().catch(() => {});
        throw new Error('Test database connection or isolation verification failed; no preparation performed.');
    }
}

async function main() {
    require('dotenv').config({ path: path.resolve(__dirname, '../.env.postgres'), quiet: true });
    const connectionString = validateTestUrl(process.env.TEST_DATABASE_URL);
    const client = await connectTestDatabase(connectionString);
    await client.end();
    const environment = { ...process.env, DATABASE_URL: connectionString, SHADOW_DATABASE_URL: '', TEST_DATABASE_URL: connectionString,
        NODE_ENV: 'test', CATALOG_INGREDIENT_STORE: 'mongodb' };
    const migration = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
        cwd: path.resolve(__dirname, '..'), env: environment, encoding: 'utf8', timeout: 60000,
    });
    if (migration.status !== 0) throw new Error('Test migration failed; CLI output withheld to protect credentials.');
    console.log('PASSED: isolated test target verified and reviewed migrations deployed.');
    const result = spawnSync(process.execPath, ['--test', 'test/postgres.integration.test.cjs', 'test/ingredients.postgres.integration.test.cjs'], {
        cwd: path.resolve(__dirname, '..'), env: environment, stdio: 'inherit', timeout: 60000,
    });
    if (result.status !== 0) throw new Error('PostgreSQL integration tests failed.');
}

module.exports = { validateTestUrl, connectTestDatabase };

if (require.main === module) {
    main().catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    });
}
