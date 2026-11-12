import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import { RequestError } from '../validation/ingredient.validation';
import type { PostgresProductInput, validateQuery } from '../validation/product.postgres.validation';
import { serializeProduct } from '../serialization/product';

const referenceConflict = () => new RequestError(409, 'Cannot remove a size referenced by recipes');
async function operation<T>(work: () => Promise<T>, retry = false): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        try { return await work(); }
        catch (error) {
            if (error instanceof RequestError) throw error;
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                const target = error.meta?.target;
                const adapter = error.meta?.driverAdapterError as { cause?: {
                    originalCode?: string; kind?: string; constraint?: { index?: string; fields?: string[] }; originalMessage?: string;
                } } | undefined;
                const cause = adapter?.cause;
                // Retry only definite transaction aborts, never connection/commit uncertainty.
                const conflict = error.code === 'P2034' || (error.code === 'P2010'
                    && ['40001', '40P01'].includes(String(error.meta?.code ?? cause?.originalCode)));
                if (retry && conflict) {
                    if (attempt < 2) continue;
                    throw new RequestError(409, 'Product update conflict');
                }
                const codeIndex = cause?.originalCode === '23505' && cause.kind === 'UniqueConstraintViolation'
                    && cause.constraint?.index === 'products_code_key';
                if (error.code === 'P2002' && error.meta?.modelName === 'Product'
                    && ((Array.isArray(target) && target.length === 1 && target[0] === 'code')
                        || target === 'products_code_key' || codeIndex)) {
                    throw new RequestError(409, 'Product code already exists');
                }
                // A concurrent FK insertion can win before variant removal. The FK is the final guard.
                if (error.code === 'P2003' && error.meta?.modelName === 'ProductVariant'
                    && error.meta?.constraint === 'recipes_product_variant_id_fkey') throw referenceConflict();
            }
            throw new Error('Product database operation failed');
        }
    }
}
const options = { maxWait: 2000, timeout: 5000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted };
async function lockProduct(tx: Prisma.TransactionClient, id: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM public.products WHERE id=${id}::uuid FOR UPDATE`;
    if (!rows.length) throw new RequestError(404, 'Product not found');
    await tx.$queryRaw`SELECT id FROM public.product_variants WHERE product_id=${id}::uuid ORDER BY id FOR UPDATE`;
}
async function readProduct(tx: Prisma.TransactionClient, id: string) {
    const row = await tx.product.findUnique({ where: { id }, include: { variants: true } });
    if (!row) throw new RequestError(404, 'Product not found');
    return serializeProduct(row);
}
export function createPostgresProductService(db: PrismaClient) {
    return {
        createProduct(input: PostgresProductInput) {
            return operation(() => db.$transaction(async tx => {
                const { prices, ...fields } = input;
                const row = await tx.product.create({ data: { ...fields, variants: { create: prices! } } as Prisma.ProductCreateInput,
                    include: { variants: true } });
                return serializeProduct(row);
            }, options), true);
        },
        listProducts(query: ReturnType<typeof validateQuery>) {
            return operation(async () => {
                const { page, limit, category, search, isAvailable } = query;
                const where: Prisma.ProductWhereInput = {};
                if (category !== undefined) where.category = category;
                if (isAvailable !== undefined) where.isAvailable = isAvailable;
                if (search !== undefined) {
                    const literal = search.replace(/[\\%_]/g, '\\$&');
                    where.OR = ['code', 'name'].map(field => ({ [field]: { contains: literal, mode: 'insensitive' } }));
                }
                // Prisma can load relations with multiple statements. Keep each aggregate coherent.
                // Count intentionally remains a separate read, matching the existing API contract.
                const [data, total] = await Promise.all([
                    db.$transaction(async tx => (await tx.product.findMany({ where, include: { variants: true },
                        orderBy: [{ code: 'asc' }, { id: 'asc' }], skip: (page - 1) * limit, take: limit })).map(serializeProduct),
                    { ...options, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }),
                    db.product.count({ where }),
                ]);
                return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
            });
        },
        getProduct(id: string) {
            return operation(() => db.$transaction(tx => readProduct(tx, id),
                { ...options, isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }));
        },
        updateProduct(id: string, input: PostgresProductInput) {
            return operation(() => db.$transaction(async tx => {
                await lockProduct(tx, id);
                const { prices, ...fields } = input;
                if (prices !== undefined) {
                    const variants = await tx.productVariant.findMany({ where: { productId: id }, orderBy: { id: 'asc' } });
                    const retained = new Set(prices.map(item => item.size));
                    const removed = variants.filter(item => !retained.has(item.size)).map(item => item.id);
                    if (removed.length) {
                        if (await tx.recipe.count({ where: { productVariantId: { in: removed } } })) throw referenceConflict();
                        await tx.productVariant.deleteMany({ where: { productId: id, id: { in: removed } } });
                    }
                    for (const item of prices) {
                        const current = variants.find(variant => variant.size === item.size);
                        if (current) {
                            if (!current.price.equals(item.price)) await tx.productVariant.update({ where: { id: current.id }, data: { price: item.price } });
                        } else {
                            await tx.productVariant.create({ data: { productId: id, ...item } });
                        }
                    }
                }
                // Explicitly touch the parent for prices-only PATCH; SQL maintains the actual timestamp.
                await tx.product.update({ where: { id }, data: { ...fields, updatedAt: new Date() } });
                return readProduct(tx, id);
            }, options), true);
        },
        deleteProduct(id: string) {
            return operation(() => db.$transaction(async tx => {
                await lockProduct(tx, id);
                const row = await tx.product.findUniqueOrThrow({ where: { id } });
                if (row.isAvailable) await tx.product.update({ where: { id }, data: { isAvailable: false } });
                return readProduct(tx, id);
            }, options), true);
        },
    };
}
