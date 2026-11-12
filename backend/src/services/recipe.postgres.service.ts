import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import { RequestError } from '../validation/ingredient.validation';
import type { PostgresRecipeInput, validateQuery } from '../validation/recipe.postgres.validation';
import { serializeRecipe } from '../serialization/recipe';

const mutationOptions = { maxWait: 2000, timeout: 5000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
const readOptions = { ...mutationOptions, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead };
const include = { ingredients: true, productVariant: true } as const;

// Read metadata, never create/repair schema. Definitions, validity and enabled
// trigger functions matter; names alone are not evidence of enforcement.
export async function verifyRecipeFoundation(tx: Prisma.TransactionClient): Promise<void> {
    const constraints = await tx.$queryRaw<{ name: string; table: string; valid: boolean; definition: string }[]>`
        SELECT conname AS name, conrelid::regclass::text AS table,
            convalidated AND NOT condeferrable AS valid, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint WHERE connamespace='public'::regnamespace`;
    const normalize = (text: string) => text.toLowerCase().replace(/[\s"()]/g, '');
    const required: Record<string, [string, string]> = {
        recipes_pkey: ['recipes', 'PRIMARY KEY (id)'],
        product_variants_pkey: ['product_variants', 'PRIMARY KEY (id)'],
        ingredients_pkey: ['ingredients', 'PRIMARY KEY (id)'],
        products_pkey: ['products', 'PRIMARY KEY (id)'],
        recipe_ingredients_pkey: ['recipe_ingredients', 'PRIMARY KEY (id)'],
        recipes_product_variant_id_fkey: ['recipes', 'FOREIGN KEY (product_variant_id) REFERENCES product_variants(id) ON UPDATE RESTRICT ON DELETE RESTRICT'],
        product_variants_product_id_fkey: ['product_variants', 'FOREIGN KEY (product_id) REFERENCES products(id) ON UPDATE RESTRICT ON DELETE RESTRICT'],
        product_variants_active_recipe_id_id_fkey: ['product_variants', 'FOREIGN KEY (active_recipe_id,id) REFERENCES recipes(id,product_variant_id) ON UPDATE RESTRICT ON DELETE RESTRICT'],
        recipe_ingredients_recipe_id_fkey: ['recipe_ingredients', 'FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON UPDATE RESTRICT ON DELETE RESTRICT'],
        recipe_ingredients_ingredient_id_fkey: ['recipe_ingredients', 'FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON UPDATE RESTRICT ON DELETE RESTRICT'],
        recipes_version_check: ['recipes', 'CHECK (version > 0)'],
        recipe_ingredients_quantity_check: ['recipe_ingredients', "CHECK (quantity > 0::numeric AND quantity <> 'NaN'::numeric)"],
    };
    const fail = (): never => { throw new Error('Recipe database foundation is unavailable'); };
    for (const [name, [table, definition]] of Object.entries(required)) {
        if (!constraints.some(row => row.name === name && row.table.replace(/^public\./, '') === table
            && row.valid && normalize(row.definition) === normalize(definition))) fail();
    }
    const indexes = await tx.$queryRaw<{ name: string; table: string; valid: boolean; columns: string[] }[]>`
        SELECT c.relname AS name, t.relname AS table,
            i.indisunique AND i.indisvalid AND i.indisready AND i.indexprs IS NULL
                AND i.indpred IS NULL AND i.indnkeyatts=i.indnatts AS valid,
            ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(attnum,n)
                JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum ORDER BY k.n) AS columns
        FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid
        WHERE t.relnamespace='public'::regnamespace`;
    for (const [name, table, columns] of [
        ['recipes_product_variant_id_version_key', 'recipes', 'product_variant_id,version'],
        ['recipes_id_product_variant_id_key', 'recipes', 'id,product_variant_id'],
        ['recipe_ingredients_recipe_id_ingredient_id_key', 'recipe_ingredients', 'recipe_id,ingredient_id'],
        ['product_variants_product_id_size_key', 'product_variants', 'product_id,size'],
    ]) if (!indexes.some(row => row.name === name && row.table === table && row.valid && row.columns.join() === columns)) fail();
    const triggers = await tx.$queryRaw<{ name: string; table: string; valid: boolean; definition: string }[]>`
        SELECT tg.tgname AS name, c.relname AS table,
            tg.tgtype=19 AND tg.tgenabled IN ('O','A') AND NOT tg.tgisinternal
                AND p.pronamespace='public'::regnamespace AND p.proname='catalog_set_updated_at'
                AND p.prorettype='trigger'::regtype AND p.pronargs=0 AND l.lanname='plpgsql' AS valid,
            p.prosrc AS definition
        FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_proc p ON p.oid=tg.tgfoid JOIN pg_language l ON l.oid=p.prolang
        WHERE c.relnamespace='public'::regnamespace AND NOT tg.tgisinternal`;
    for (const table of ['recipes', 'recipe_ingredients', 'product_variants']) {
        if (!triggers.some(row => row.table === table && row.name === `${table}_updated_at` && row.valid
            && normalize(row.definition) === 'beginnew.updated_at=clock_timestamp;returnnew;end;')) fail();
    }
    const columns = await tx.$queryRaw<{ valid: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='recipe_ingredients' AND column_name='quantity' AND data_type='numeric'
            AND numeric_precision=18 AND numeric_scale=6 AND is_nullable='NO')
        AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public'
            AND table_name='recipes' AND column_name='version' AND data_type='integer' AND is_nullable='NO')
        AND current_setting('session_replication_role')='origin' AS valid`;
    if (!columns[0]?.valid) fail();
}

async function operation<T>(work: () => Promise<T>, action?: 'version' | 'activation' | 'deactivation'): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try { return await work(); }
        catch (error) {
            if (error instanceof RequestError) throw error;
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                const target = error.meta?.target;
                const adapter = error.meta?.driverAdapterError as { cause?: { originalCode?: string; kind?: string; constraint?: { index?: string } } } | undefined;
                const cause = adapter?.cause;
                const version = error.code === 'P2002' && error.meta?.modelName === 'Recipe'
                    && ((Array.isArray(target) && target.join() === 'product_variant_id,version')
                        || (Array.isArray(target) && target.join() === 'productVariantId,version')
                        || target === 'recipes_product_variant_id_version_key'
                        || (cause?.originalCode === '23505' && cause.kind === 'UniqueConstraintViolation'
                            && cause.constraint?.index === 'recipes_product_variant_id_version_key'));
                const retryable = error.code === 'P2034' || (error.code === 'P2010'
                    && ['40001', '40P01'].includes(String(error.meta?.code ?? cause?.originalCode)));
                if (action && (retryable || (action === 'version' && version))) {
                    if (attempt < 2) continue;
                    throw new RequestError(409, action === 'version' ? 'Recipe version conflict' : 'Recipe activation conflict');
                }
            }
            // Do not propagate raw SQL, causes, adapter details or uncertain-outcome claims.
            throw new Error('Recipe database operation failed');
        }
    }
}
async function readRecipe(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.recipe.findUnique({ where: { id }, include });
    if (!row) throw new RequestError(404, 'Recipe not found');
    return serializeRecipe(row);
}
async function lockProduct(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<{ id: string; is_available: boolean }[]>`
        SELECT id,is_available FROM public.products WHERE id=${id}::uuid FOR SHARE`;
    if (!rows[0]) throw new RequestError(404, 'Product not found');
    return rows[0];
}
async function lockIngredients(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return [];
    const rows = await tx.$queryRaw<{ id: string; is_active: boolean }[]>`
        SELECT id,is_active FROM public.ingredients WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR SHARE`;
    if (rows.length !== ids.length) throw new RequestError(404, 'Ingredient not found');
    return rows;
}
async function lockAssociation(tx: Prisma.TransactionClient, id: string) {
    // Resolve without locking, then acquire the global hierarchy and re-read.
    const initial = await tx.recipe.findUnique({ where: { id }, include: { productVariant: true } });
    if (!initial) throw new RequestError(404, 'Recipe not found');
    const product = await lockProduct(tx, initial.productVariant.productId);
    await tx.$queryRaw`SELECT id FROM public.product_variants WHERE id=${initial.productVariantId}::uuid FOR UPDATE`;
    const row = await tx.recipe.findUnique({ where: { id }, include });
    if (!row) throw new RequestError(404, 'Recipe not found');
    if (row.productVariantId !== initial.productVariantId || row.productVariant.productId !== product.id) throw new Error('Recipe association changed');
    return { row, product };
}
async function lockRecipes(tx: Prisma.TransactionClient, ids: string[]) {
    await tx.$queryRaw`SELECT id FROM public.recipes WHERE id IN (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) ORDER BY id FOR UPDATE`;
}
export function createPostgresRecipeService(db: PrismaClient) {
    return {
        createRecipe(input: PostgresRecipeInput) {
            return operation(() => db.$transaction(async tx => {
                await verifyRecipeFoundation(tx);
                await lockProduct(tx, input.productId);
                const variants = await tx.$queryRaw<{ id: string }[]>`
                    SELECT id FROM public.product_variants WHERE product_id=${input.productId}::uuid
                        AND size=${input.size}::"ProductSize" FOR UPDATE`;
                await lockIngredients(tx, input.ingredients.map(item => item.ingredientId));
                const variant = variants[0];
                if (!variant) throw new RequestError(409, 'Product size is not supported');
                await tx.$queryRaw`SELECT id FROM public.recipes WHERE product_variant_id=${variant.id}::uuid ORDER BY id FOR UPDATE`;
                const latest = await tx.recipe.aggregate({ where: { productVariantId: variant.id }, _max: { version: true } });
                const maximum = latest._max.version ?? 0;
                if (!Number.isInteger(maximum) || maximum < 0 || maximum >= 2147483647) throw new Error('Recipe version range is invalid');
                const row = await tx.recipe.create({ data: { productVariantId: variant.id, version: maximum + 1,
                    ingredients: { create: input.ingredients } }, include });
                return serializeRecipe(row);
            }, mutationOptions), 'version');
        },
        getRecipe(id: string) {
            return operation(() => db.$transaction(tx => readRecipe(tx, id), readOptions));
        },
        listRecipes(query: ReturnType<typeof validateQuery>) {
            return operation(async () => {
                const clauses: Prisma.Sql[] = [];
                if (query.productId !== undefined) clauses.push(Prisma.sql`v.product_id=${query.productId}::uuid`);
                if (query.size !== undefined) clauses.push(Prisma.sql`v.size=${query.size}::"ProductSize"`);
                if (query.isActive !== undefined) clauses.push(query.isActive
                    ? Prisma.sql`v.active_recipe_id=r.id` : Prisma.sql`v.active_recipe_id IS DISTINCT FROM r.id`);
                const where = clauses.length ? Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}` : Prisma.empty;
                const data = await db.$transaction(async tx => {
                    // Cast enum to text to retain the legacy lexical L/M/S order.
                    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
                        SELECT r.id FROM public.recipes r JOIN public.product_variants v ON v.id=r.product_variant_id
                        ${where} ORDER BY v.product_id,v.size::text COLLATE "C",r.version DESC,r.id
                        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`);
                    const rows = await tx.recipe.findMany({ where: { id: { in: ids.map(row => row.id) } }, include });
                    const byId = new Map(rows.map(row => [row.id, row]));
                    return ids.map(row => serializeRecipe(byId.get(row.id)!));
                }, readOptions);
                // Separate count/data reads intentionally match the existing API contract.
                const counts = await db.$queryRaw<{ total: bigint }[]>(Prisma.sql`
                    SELECT count(*) AS total FROM public.recipes r JOIN public.product_variants v ON v.id=r.product_variant_id ${where}`);
                const total = Number(counts[0]!.total);
                if (!Number.isSafeInteger(total)) throw new Error('Recipe count range is invalid');
                return { data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
            });
        },
        activateRecipe(id: string) {
            return operation(() => db.$transaction(async tx => {
                await verifyRecipeFoundation(tx);
                const { row, product } = await lockAssociation(tx, id);
                const ingredients = await lockIngredients(tx, row.ingredients.map(item => item.ingredientId));
                const ids = [...new Set([id, ...(row.productVariant.activeRecipeId ? [row.productVariant.activeRecipeId] : [])])];
                await lockRecipes(tx, ids);
                if (!row.ingredients.length) throw new RequestError(409, 'Recipe has no ingredients');
                if (!product.is_available || ingredients.some(item => !item.is_active)) throw new RequestError(409, 'Recipe references are unavailable');
                if (row.productVariant.activeRecipeId !== id) {
                    await tx.productVariant.update({ where: { id: row.productVariantId }, data: { activeRecipeId: id } });
                    await tx.recipe.updateMany({ where: { id: { in: ids } }, data: { updatedAt: new Date() } });
                }
                return readRecipe(tx, id);
            }, mutationOptions), 'activation');
        },
        deactivateRecipe(id: string) {
            return operation(() => db.$transaction(async tx => {
                await verifyRecipeFoundation(tx);
                const { row } = await lockAssociation(tx, id);
                await lockRecipes(tx, [id]);
                const changed = await tx.productVariant.updateMany({ where: { id: row.productVariantId, activeRecipeId: id }, data: { activeRecipeId: null } });
                if (changed.count) await tx.recipe.update({ where: { id }, data: { updatedAt: new Date() } });
                return readRecipe(tx, id);
            }, mutationOptions), 'deactivation');
        },
    };
}
