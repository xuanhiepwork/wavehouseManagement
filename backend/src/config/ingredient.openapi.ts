const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ref('IngredientError')) });
const errors = { '400': error('Invalid request'), '404': error('Ingredient not found'),
    '409': error('Ingredient code already exists'), '500': error('Internal server error') };
const properties = {
    code: { type: 'string', minLength: 1, description: 'Trimmed and uppercased; unique across active and inactive records.' },
    name: { type: 'string', minLength: 1, description: 'Trimmed; must contain non-whitespace characters.' },
    category: { type: 'string', minLength: 1, description: 'Trimmed; must contain non-whitespace characters.' },
    unit: { type: 'string', enum: ['g', 'ml', 'piece'] },
    costPrice: { type: 'number', minimum: 0, description: 'Finite JSON number; numeric strings are rejected.' },
    minStock: { type: 'number', minimum: 0, default: 0 },
    isActive: { type: 'boolean', default: true },
};
const single = { description: 'Ingredient', content: json({ type: 'object', properties: { data: ref('Ingredient') } }) };
const id = { name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } };
const body = (name: string) => ({ required: true, content: json(ref(name)) });
const query = (name: string, schema: object, description: string) => ({ name, in: 'query', schema, description });

export const ingredientSchemas = {
    IngredientInput: { type: 'object', additionalProperties: false,
        required: ['code', 'name', 'category', 'unit', 'costPrice'], properties },
    IngredientPatch: { type: 'object', additionalProperties: false, minProperties: 1, properties },
    Ingredient: { type: 'object', properties: { ...properties,
        _id: { type: 'string' }, __v: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
    IngredientError: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
};

export const ingredientPaths = {
    '/api/ingredients': {
        post: { tags: ['Ingredients'], summary: 'Create an ingredient', requestBody: body('IngredientInput'),
            responses: { '201': single, ...errors } },
        get: { tags: ['Ingredients'], summary: 'List ingredients',
            description: 'Defaults to active records. Search matches literal substrings of code/name, case-insensitively. Category is an exact trimmed match. Unknown/repeated parameters are rejected. Sorting always adds _id in the same direction for deterministic ties. Counts and records are separate reads, not a transactional snapshot.',
            parameters: [
                query('page', { type: 'integer', minimum: 1, default: 1 }, 'Positive safe integer.'),
                query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'Page size.'),
                query('category', { type: 'string', minLength: 1 }, 'Exact category.'),
                query('unit', { type: 'string', enum: ['g', 'ml', 'piece'] }, 'Unit.'),
                query('isActive', { type: 'boolean', default: true }, 'Only literal true or false.'),
                query('search', { type: 'string', minLength: 1 }, 'Literal code/name substring.'),
                query('sortBy', { type: 'string', default: 'name', enum: ['name', 'code', 'category', 'unit', 'costPrice', 'minStock', 'createdAt', 'updatedAt'] }, 'Sort field.'),
                query('sortOrder', { type: 'string', enum: ['asc', 'desc'], default: 'asc' }, 'Sort direction.'),
            ], responses: { '200': { description: 'Paginated ingredients', content: json({ type: 'object', properties: {
                data: { type: 'array', items: ref('Ingredient') }, pagination: { type: 'object', properties: {
                    page: { type: 'integer' }, limit: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' },
                } },
            } }) }, '400': errors['400'], '500': errors['500'] } },
    },
    '/api/ingredients/{id}': {
        parameters: [id],
        get: { tags: ['Ingredients'], summary: 'Get an ingredient, including inactive records', responses: { '200': single, ...errors } },
        patch: { tags: ['Ingredients'], summary: 'Update supplied catalog fields',
            description: 'Loads the document and saves with schema validation/normalization. isActive may reactivate records. IDs, timestamps, version, stock and unknown fields are rejected.',
            requestBody: body('IngredientPatch'), responses: { '200': single, ...errors } },
        delete: { tags: ['Ingredients'], summary: 'Soft-delete an ingredient',
            description: 'Sets isActive=false and returns the document. Repeated deletion returns 200 without another save. The code remains reserved.',
            responses: { '200': single, ...errors } },
    },
};

// Runtime uniqueness depends on a successfully provisioned MongoDB unique index.
// Mongoose manages autoIndex via the existing connection lifecycle; deployments
// disabling it must provision indexes externally. No request initializes indexes.

export function postgresIngredientDocumentation() {
    const decimal = (scale: number) => ({
        oneOf: [{ type: 'string', pattern: `^[0-9]+(\\.[0-9]{1,${scale}})?$`, maxLength: 100 }, { type: 'number', minimum: 0 }],
        description: `Unsigned plain decimal string or bounded finite JSON number. NUMERIC(18,${scale}); at most ${18 - scale} integer digits and ${scale} fractional digits. Excess scale (including trailing zeroes), overflow and negative zero numbers are rejected; no rounding. Numeric input additionally requires scaled integer units <= Number.MAX_SAFE_INTEGER. Use strings for exact large values.`,
    });
    const inputs = { ...properties,
        code: { ...properties.code, maxLength: 64 }, name: { ...properties.name, maxLength: 200 },
        category: { ...properties.category, maxLength: 100 }, costPrice: decimal(4), minStock: { ...decimal(6), default: '0' },
    };
    const outputDecimal = { type: 'string', pattern: '^(0|[1-9][0-9]*)(\\.[0-9]*[1-9])?$',
        description: 'Canonical decimal string: no exponent, redundant leading zeroes or trailing fractional zeroes.' };
    const schemas = {
        IngredientInput: { ...ingredientSchemas.IngredientInput, properties: inputs },
        IngredientPatch: { ...ingredientSchemas.IngredientPatch, properties: inputs },
        Ingredient: { type: 'object', description: 'PostgreSQL mode: _id is a UUID; __v is omitted. Decimal fields are canonical strings.', properties: {
            ...inputs, costPrice: outputDecimal, minStock: outputDecimal,
            _id: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
        } },
    };
    const paths = structuredClone(ingredientPaths);
    paths['/api/ingredients/{id}'].parameters[0]!.schema.pattern = '^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$';
    paths['/api/ingredients/{id}'].patch.description = 'Updates supplied fields atomically, with explicit normalization. isActive may reactivate records. IDs, timestamps, version, stock and unknown fields are rejected.';
    paths['/api/ingredients'].get.description += ' PostgreSQL mode uses UUID tie-breakers and database collation; maximum offset is 2147483647. This local/test-only Ingredient store is separate from the legacy MongoDB Recipe catalog.';
    return { schemas, paths };
}
