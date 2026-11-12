const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { connectTestDatabase, validateTestUrl } = require('../scripts/test-postgres.cjs');

test('PostgreSQL test URL guard rejects unsafe targets before connecting', () => {
    const safe = 'postgresql://wavehouse_test:fixture@127.0.0.1:5433/wavehouse_test';
    assert.equal(validateTestUrl(safe), safe);
    for (const unsafe of [undefined, '', 'invalid',
        safe.replace('/wavehouse_test', '/wavehouse_dev'),
        safe.replace('wavehouse_test:', 'wavehouse_dev:'),
        safe.replace('127.0.0.1', 'example.com'),
        safe.replace(':5433', ':5432'),
        safe.replace(':fixture@', '@'),
        `${safe}?options=-crole=wavehouse_dev`, `${safe}#fragment`]) {
        assert.throws(() => validateTestUrl(unsafe));
    }
    assert.throws(() => validateTestUrl('postgresql://secret-password'), error => !error.message.includes('secret-password'));
});

test('PostgreSQL catalog constraints and exact decimals', {
    skip: !process.env.TEST_DATABASE_URL ? 'TEST_DATABASE_URL is not configured' : false,
    timeout: 30000,
}, async context => {
    const client = await connectTestDatabase(process.env.TEST_DATABASE_URL);
    const ingredientId = randomUUID();
    const productId = randomUUID();
    const variantId = randomUUID();
    const otherVariantId = randomUUID();
    const recipeId = randomUUID();
    const otherRecipeId = randomUUID();
    const code = randomUUID().replaceAll('-', '').toUpperCase();
    const reject = async (sql, values, expectedCode) => {
        await client.query('SAVEPOINT rejected_write');
        try {
            await assert.rejects(client.query(sql, values), error => error.code === expectedCode);
        } finally {
            await client.query('ROLLBACK TO SAVEPOINT rejected_write');
            await client.query('RELEASE SAVEPOINT rejected_write');
        }
    };
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL statement_timeout = '5s'");
        await client.query("SET LOCAL lock_timeout = '2s'");
        await client.query(`INSERT INTO ingredients (id, code, name, category, unit, cost_price, min_stock)
            VALUES ($1, $2, 'Coffee', 'Test', 'g', '0.1001', '0.000001')`, [ingredientId, code]);
        await client.query(`INSERT INTO products (id, code, name, category)
            VALUES ($1, $2, 'Coffee', 'Test')`, [productId, code]);
        await client.query(`INSERT INTO product_variants (id, product_id, size, price)
            VALUES ($1, $3, 'M', '12345678901234.1234'), ($2, $3, 'L', '0')`, [variantId, otherVariantId, productId]);
        await client.query(`INSERT INTO recipes (id, product_variant_id, version)
            VALUES ($1, $3, 1), ($2, $4, 1)`, [recipeId, otherRecipeId, variantId, otherVariantId]);
        await client.query(`INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity)
            VALUES ($1, $2, '0.123456')`, [recipeId, ingredientId]);

        await context.test('exact numeric values remain strings, UUIDs and timestamps default', async () => {
            const { rows: [row] } = await client.query('SELECT id, quantity, created_at, updated_at FROM recipe_ingredients WHERE recipe_id = $1', [recipeId]);
            assert.equal(row.quantity, '0.123456');
            assert.match(row.id, /^[0-9a-f-]{36}$/);
            assert.ok(row.created_at instanceof Date);
            assert.ok(row.updated_at instanceof Date);
            const { rows: [variant] } = await client.query('SELECT price FROM product_variants WHERE id = $1', [variantId]);
            assert.equal(variant.price, '12345678901234.1234');
        });
        await context.test('unique codes, sizes, versions and ingredient membership', async () => {
            await reject('UPDATE products SET code = $1 WHERE id = $2', ['', productId], '23514');
            await reject(`INSERT INTO ingredients (code, name, category, unit, cost_price) VALUES ($1, 'Other', 'Test', 'g', 0)`, [code], '23505');
            await reject(`INSERT INTO products (code, name, category) VALUES ($1, 'Other', 'Test')`, [code], '23505');
            await reject(`INSERT INTO product_variants (product_id, size, price) VALUES ($1, 'M', 0)`, [productId], '23505');
            await reject('INSERT INTO recipes (product_variant_id, version) VALUES ($1, 1)', [variantId], '23505');
            await reject('INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity) VALUES ($1, $2, 1)', [recipeId, ingredientId], '23505');
        });
        await context.test('negative, zero, NaN and invalid enum values are rejected', async () => {
            for (const value of ['-1', 'NaN']) {
                await reject('UPDATE ingredients SET cost_price = $1 WHERE id = $2', [value, ingredientId], '23514');
                await reject('UPDATE ingredients SET min_stock = $1 WHERE id = $2', [value, ingredientId], '23514');
                await reject('UPDATE product_variants SET price = $1 WHERE id = $2', [value, variantId], '23514');
            }
            for (const value of ['0', '-1', 'NaN']) {
                await reject('UPDATE recipe_ingredients SET quantity = $1 WHERE recipe_id = $2', [value, recipeId], '23514');
            }
            await reject('UPDATE recipes SET version = 0 WHERE id = $1', [recipeId], '23514');
            await reject("UPDATE ingredients SET unit = 'kg' WHERE id = $1", [ingredientId], '22P02');
            await reject("UPDATE product_variants SET size = 'XL' WHERE id = $1", [variantId], '22P02');
        });
        await context.test('active pointer belongs to its variant and supports version transitions', async () => {
            await reject('UPDATE product_variants SET active_recipe_id = $1 WHERE id = $2', [otherRecipeId, variantId], '23503');
            await reject('UPDATE product_variants SET active_recipe_id = $1 WHERE id = $2', [randomUUID(), variantId], '23503');
            await client.query('UPDATE product_variants SET active_recipe_id = $1 WHERE id = $2', [recipeId, variantId]);
            const nextId = randomUUID();
            await client.query('INSERT INTO recipes (id, product_variant_id, version) VALUES ($1, $2, 2)', [nextId, variantId]);
            await client.query('UPDATE product_variants SET active_recipe_id = $1 WHERE id = $2', [nextId, variantId]);
            const { rows } = await client.query('SELECT version FROM recipes WHERE product_variant_id = $1 ORDER BY version', [variantId]);
            assert.deepEqual(rows.map(row => row.version), [1, 2]);
            await reject('DELETE FROM recipes WHERE id = $1', [nextId], '23503');
            await reject('UPDATE recipes SET product_variant_id = $1 WHERE id = $2', [otherVariantId, nextId], '23503');
            await client.query('UPDATE product_variants SET active_recipe_id = NULL WHERE id = $1', [variantId]);
        });
        await context.test('foreign keys restrict referenced history and reject missing parents', async () => {
            await reject('DELETE FROM ingredients WHERE id = $1', [ingredientId], '23503');
            await reject('DELETE FROM products WHERE id = $1', [productId], '23503');
            await reject('DELETE FROM product_variants WHERE id = $1', [variantId], '23503');
            await reject('DELETE FROM recipes WHERE id = $1', [recipeId], '23503');
            await reject('UPDATE recipe_ingredients SET ingredient_id = $1 WHERE recipe_id = $2', [randomUUID(), recipeId], '23503');
            await reject('UPDATE recipe_ingredients SET recipe_id = $1 WHERE recipe_id = $2', [randomUUID(), recipeId], '23503');
            await reject('UPDATE recipes SET product_variant_id = $1 WHERE id = $2', [randomUUID(), otherRecipeId], '23503');
            await reject('UPDATE product_variants SET product_id = $1 WHERE id = $2', [randomUUID(), variantId], '23503');
        });
        await context.test('direct SQL updates maintain updated_at', async () => {
            await client.query('UPDATE products SET updated_at = $1 WHERE id = $2', [new Date('2000-01-01'), productId]);
            const { rows: [row] } = await client.query('SELECT updated_at > $1::timestamptz AS updated FROM products WHERE id = $2', ['2000-01-01', productId]);
            assert.equal(row.updated, true);
        });
    } finally {
        await client.query('ROLLBACK').finally(() => client.end());
    }
});
