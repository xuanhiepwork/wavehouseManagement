
import {
    Router,
    type RequestHandler,
    type Response,
} from 'express';
import {
    Prisma,
    type PrismaClient,
} from '../generated/prisma/client';
import {
    applyInventoryMovement,
    InventoryError,
} from '../services/inventory.service';
import {
    UUID_RE,
    readBody,
    readPage,
    onlyKeys,
    prismaErrorCode,
} from '../utils/admin-api';

type Actor = {
    id: string;
    role: 'ADMIN' | 'BRANCH_MANAGER' | 'STAFF';
    branchId: string | null;
};

class ConsumptionError extends Error {
    constructor(
        message: string,
        public readonly status = 409
    ) {
        super(message);
    }
}

const txOptions = {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 5000,
    timeout: 30000,
};

const MAX_QUANTITY = new Prisma.Decimal('999999999999.999999');

const consumptionSelect = {
    id: true,
    eventId: true,
    branchId: true,
    productVariantId: true,
    recipeId: true,
    units: true,
    createdById: true,
    createdAt: true,
    recipe: {
        select: { version: true },
    },
    items: {
        select: {
            ingredientId: true,
            perUnitQuantity: true,
            totalQuantity: true,
        },
        orderBy: { ingredientId: 'asc' },
    },
} as const;

function actorOf(res: Response): Actor {
    return res.locals.authUser as Actor;
}

function scope(actor: Actor) {
    return actor.role === 'ADMIN'
        ? {}
        : { branchId: actor.branchId! };
}

function sendError(res: Response, error: unknown) {
    if (
        error instanceof ConsumptionError ||
        error instanceof InventoryError
    ) {
        res.status(error.status).json({
            error: error.message,
        });
        return;
    }

    const code = prismaErrorCode(error);

    if (code === 'P2002' || code === 'P2034') {
        res.status(409).json({
            error: 'Concurrent operation. Retry with the same eventId.',
        });
        return;
    }

    if (code === 'P2003') {
        res.status(409).json({
            error: 'Related data is unavailable',
        });
        return;
    }

    res.status(503).json({
        error: 'Recipe consumption database unavailable',
    });
}

const requireWriter: RequestHandler = (_req, res, next) => {
    const actor = res.locals.authUser as Actor | undefined;

    if (
        !actor ||
        (
            actor.role !== 'ADMIN' &&
            actor.role !== 'BRANCH_MANAGER'
        )
    ) {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }

    next();
};

export function createRecipeConsumptionRouter(
    prisma: PrismaClient
) {
    const router = Router();

    // GET /api/recipe-consumptions
    router.get('/', async (req, res) => {
        const actor = actorOf(res);
        const page = readPage(req.query.page);
        const branchFilter = req.query.branchId;

        if (
            page === null ||
            (
                branchFilter !== undefined &&
                (
                    typeof branchFilter !== 'string' ||
                    !UUID_RE.test(branchFilter)
                )
            )
        ) {
            res.status(400).json({ error: 'Invalid query' });
            return;
        }

        if (
            typeof branchFilter === 'string' &&
            actor.role !== 'ADMIN' &&
            branchFilter.toLowerCase() !== actor.branchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        const where = {
            ...scope(actor),
            ...(
                actor.role === 'ADMIN' &&
                    typeof branchFilter === 'string'
                    ? { branchId: branchFilter.toLowerCase() }
                    : {}
            ),
        };

        try {
            const [total, items] = await Promise.all([
                prisma.recipeConsumption.count({ where }),
                prisma.recipeConsumption.findMany({
                    where,
                    select: {
                        id: true,
                        eventId: true,
                        branchId: true,
                        productVariantId: true,
                        recipeId: true,
                        units: true,
                        createdById: true,
                        createdAt: true,
                    },
                    orderBy: [
                        { createdAt: 'desc' },
                        { id: 'desc' },
                    ],
                    skip: (page - 1) * 50,
                    take: 50,
                }),
            ]);

            res.json({ items, total, page });
        } catch (error) {
            sendError(res, error);
        }
    });

    // GET /api/recipe-consumptions/:id
    router.get('/:id', async (req, res) => {
        const id = req.params.id;

        if (typeof id !== 'string' || !UUID_RE.test(id)) {
            res.status(400).json({
                error: 'Invalid consumption ID',
            });
            return;
        }

        try {
            const record = await prisma.recipeConsumption.findFirst({
                where: {
                    id: id.toLowerCase(),
                    ...scope(actorOf(res)),
                },
                select: consumptionSelect,
            });

            if (!record) {
                res.status(404).json({
                    error: 'Consumption not found',
                });
                return;
            }

            res.json({ data: record });
        } catch (error) {
            sendError(res, error);
        }
    });

    // POST /api/recipe-consumptions
    // One eventId identifies one completed sale line.
    router.post('/', requireWriter, async (req, res) => {
        const body = readBody(req.body);

        if (
            !body ||
            !onlyKeys(body, [
                'eventId',
                'branchId',
                'productVariantId',
                'units',
            ])
        ) {
            res.status(400).json({
                error: 'Invalid request',
            });
            return;
        }

        const eventValue = body.eventId;
        const branchValue = body.branchId;
        const variantValue = body.productVariantId;
        const unitsValue = body.units;

        if (
            typeof eventValue !== 'string' ||
            !UUID_RE.test(eventValue) ||
            typeof branchValue !== 'string' ||
            !UUID_RE.test(branchValue) ||
            typeof variantValue !== 'string' ||
            !UUID_RE.test(variantValue) ||
            typeof unitsValue !== 'number' ||
            !Number.isInteger(unitsValue) ||
            unitsValue < 1 ||
            unitsValue > 1000
        ) {
            res.status(400).json({
                error: 'Invalid consumption data',
            });
            return;
        }

        const eventId = eventValue.toLowerCase();
        const branchId = branchValue.toLowerCase();
        const productVariantId = variantValue.toLowerCase();
        const units = unitsValue;
        const actor = actorOf(res);

        if (
            actor.role !== 'ADMIN' &&
            actor.branchId !== branchId
        ) {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }

        try {
            const result = await prisma.$transaction(async tx => {
                // Idempotency: replaying an already processed
                // sale event never changes stock again.
                const existing = await tx.recipeConsumption.findUnique({
                    where: { eventId },
                    select: consumptionSelect,
                });

                if (existing) {
                    if (
                        existing.branchId !== branchId ||
                        existing.productVariantId !== productVariantId ||
                        existing.units !== units
                    ) {
                        throw new ConsumptionError(
                            'eventId belongs to another operation'
                        );
                    }

                    return {
                        data: existing,
                        replayed: true,
                    };
                }

                const branch = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { isActive: true },
                });

                if (!branch?.isActive) {
                    throw new ConsumptionError(
                        'Branch unavailable'
                    );
                }

                const variant = await tx.productVariant.findUnique({
                    where: { id: productVariantId },
                    select: {
                        activeRecipeId: true,
                        product: {
                            select: { isAvailable: true },
                        },
                        activeRecipe: {
                            select: {
                                id: true,
                                version: true,
                                ingredients: {
                                    select: {
                                        ingredientId: true,
                                        quantity: true,
                                        ingredient: {
                                            select: { isActive: true },
                                        },
                                    },
                                    orderBy: {
                                        ingredientId: 'asc',
                                    },
                                },
                            },
                        },
                    },
                });

                if (
                    !variant ||
                    !variant.product.isAvailable ||
                    !variant.activeRecipeId ||
                    !variant.activeRecipe
                ) {
                    throw new ConsumptionError(
                        'Product or active recipe unavailable'
                    );
                }

                const recipe = variant.activeRecipe;

                if (
                    recipe.ingredients.length === 0 ||
                    recipe.ingredients.length > 50
                ) {
                    throw new ConsumptionError(
                        'Recipe ingredient list is invalid'
                    );
                }

                const lines = recipe.ingredients.map(item => {
                    const perUnit = item.quantity;
                    const total = perUnit.mul(units);

                    if (
                        !item.ingredient.isActive ||
                        perUnit.lte(0) ||
                        total.lte(0) ||
                        total.gt(MAX_QUANTITY)
                    ) {
                        throw new ConsumptionError(
                            'Invalid or inactive recipe ingredient'
                        );
                    }

                    return {
                        ingredientId: item.ingredientId,
                        perUnitQuantity: perUnit,
                        totalQuantity: total,
                    };
                });

                // Create the business record and a snapshot
                // of the recipe used for this event.
                const consumption = await tx.recipeConsumption.create({
                    data: {
                        eventId,
                        branchId,
                        productVariantId,
                        recipeId: recipe.id,
                        units,
                        createdById: actor.id,
                        items: {
                            create: lines.map(line => ({
                                ingredientId: line.ingredientId,
                                perUnitQuantity: line.perUnitQuantity,
                                totalQuantity: line.totalQuantity,
                            })),
                        },
                    },
                    select: consumptionSelect,
                });

                // All ingredient deductions belong to
                // the same database transaction.
                for (const line of lines) {
                    await applyInventoryMovement(tx, {
                        branchId,
                        ingredientId: line.ingredientId,
                        actorId: actor.id,
                        sourceId: consumption.id,
                        kind: 'RECIPE_CONSUMPTION',
                        delta: `-${line.totalQuantity.toFixed(6)}`,
                    });
                }

                return {
                    data: consumption,
                    replayed: false,
                };
            }, txOptions);

            res.status(result.replayed ? 200 : 201).json(result);
        } catch (error) {
            sendError(res, error);
        }
    });

    return router;
}
