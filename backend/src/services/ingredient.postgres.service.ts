import { Prisma } from '../generated/prisma/client';
import type { PrismaClient } from '../generated/prisma/client';
import { RequestError } from '../validation/ingredient.validation';
import type { PostgresIngredientInput, validateQuery } from '../validation/ingredient.postgres.validation';
import { serializeIngredient } from '../serialization/ingredient';

async function operation<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) {
        if (error instanceof RequestError) throw error;
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            const target = error.meta?.target;
            const adapter = error.meta?.driverAdapterError as { cause?: {
                originalCode?: string; kind?: string; constraint?: { index?: string };
            } } | undefined;
            const cause = adapter?.cause;
            const codeIndex = cause?.originalCode === '23505' && cause.kind === 'UniqueConstraintViolation'
                && cause.constraint?.index === 'ingredients_code_key';
            if (error.code === 'P2002' && error.meta?.modelName === 'Ingredient'
                && ((Array.isArray(target) && target.length === 1 && target[0] === 'code')
                    || target === 'ingredients_code_key' || codeIndex)) {
                throw new RequestError(409, 'Ingredient code already exists');
            }
            if (error.code === 'P2025') throw new RequestError(404, 'Ingredient not found');
        }
        // Never retain raw adapter errors, query arguments or connection details.
        throw new Error('Ingredient database operation failed');
    }
}
export function createPostgresIngredientService(db: PrismaClient) {
    return {
        createIngredient(input: PostgresIngredientInput) {
            return operation(async () => serializeIngredient(await db.ingredient.create({ data: input as Prisma.IngredientCreateInput })));
        },
        listIngredients(query: ReturnType<typeof validateQuery>) {
            return operation(async () => {
                const { page, limit, category, unit, isActive, search, sortBy, sortOrder } = query;
                const where: Prisma.IngredientWhereInput = { isActive };
                if (category !== undefined) where.category = category;
                if (unit !== undefined) where.unit = unit;
                if (search !== undefined) {
                    const literal = search.replace(/[\\%_]/g, '\\$&');
                    where.OR = ['code', 'name'].map(field => ({ [field]: { contains: literal, mode: 'insensitive' } }));
                }
                const [rows, total] = await Promise.all([
                    db.ingredient.findMany({ where, orderBy: [{ [sortBy]: sortOrder }, { id: sortOrder }], skip: (page - 1) * limit, take: limit }),
                    db.ingredient.count({ where }),
                ]);
                return { data: rows.map(serializeIngredient), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
            });
        },
        getIngredient(id: string) {
            return operation(async () => {
                const row = await db.ingredient.findUnique({ where: { id } });
                if (!row) throw new RequestError(404, 'Ingredient not found');
                return serializeIngredient(row);
            });
        },
        updateIngredient(id: string, input: PostgresIngredientInput) {
            return operation(async () => serializeIngredient(await db.ingredient.update({ where: { id }, data: input })));
        },
        deleteIngredient(id: string) {
            return operation(() => db.$transaction(async tx => {
                // Serialize DELETE against concurrent PATCH/DELETE without rewriting stale fields.
                await tx.$queryRaw`SELECT id FROM public.ingredients WHERE id = ${id}::uuid FOR UPDATE`;
                const row = await tx.ingredient.findUnique({ where: { id } });
                if (!row) throw new RequestError(404, 'Ingredient not found');
                return serializeIngredient(row.isActive
                    ? await tx.ingredient.update({ where: { id }, data: { isActive: false } }) : row);
            }, { maxWait: 2000, timeout: 5000 }));
        },
    };
}
