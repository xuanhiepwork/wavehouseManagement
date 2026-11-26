const { readdirSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Unit fixtures are database-free even when the parent shell has live test URLs.
const files = readdirSync(path.resolve(__dirname, '../test'))
    .filter(file => file.endsWith('.test.cjs') && !file.endsWith('.integration.test.cjs'))
    .sort().map(file => `test/${file}`);
const result = spawnSync(process.execPath, ['--test', ...files], {
    cwd: path.resolve(__dirname, '..'), stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', TEST_DATABASE_URL: '', MONGODB_TEST_URI: '',
        CATALOG_INGREDIENT_STORE: 'postgres', CATALOG_PRODUCT_STORE: 'postgres', CATALOG_RECIPE_STORE: 'postgres' },
});
process.exitCode = result.status ?? 1;
