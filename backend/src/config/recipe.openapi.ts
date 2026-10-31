const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ref('RecipeError')) });
const errors = { '400': error('Invalid request'), '404': error('Recipe, Product or Ingredient not found'),
    '409': error('Version/activation conflict, unsupported size, or unavailable references'), '500': error('Internal server error') };
const objectId = { type: 'string', pattern: '^[a-fA-F0-9]{24}$' };
const contentProperties = {
    productId: objectId, size: { type: 'string', enum: ['S', 'M', 'L'] },
    ingredients: { type: 'array', minItems: 1, items: ref('RecipeIngredient'),
        description: 'Distinct ingredient IDs, including after ObjectId case normalization.' },
};
const single = { description: 'Recipe with raw reference IDs', content: json({ type: 'object', required: ['data'], properties: { data: ref('Recipe') } }) };
const actionBody = { required: false, content: json({ type: 'object', additionalProperties: false, maxProperties: 0 }),
    description: 'Omit the body or send {}. No fields, including isActive, are accepted.' };
const query = (name: string, schema: object, description: string) => ({ name, in: 'query', schema, description });

export const recipeSchemas = {
    RecipeIngredient: { type: 'object', additionalProperties: false, required: ['ingredientId', 'quantity'], properties: {
        ingredientId: objectId, quantity: { type: 'number', minimum: 0, exclusiveMinimum: true,
            description: 'Finite JSON number strictly greater than zero; numeric strings and null are rejected.' },
    } },
    RecipeInput: { type: 'object', additionalProperties: false, required: ['productId', 'size', 'ingredients'], properties: contentProperties,
        description: 'Only these fields are accepted. version, isActive, IDs, timestamps, operators and unknown nested fields are protected.' },
    Recipe: { type: 'object', properties: { ...contentProperties, _id: objectId, __v: { type: 'integer' },
        version: { type: 'integer', minimum: 1, description: 'Server-generated; immutable.' },
        isActive: { type: 'boolean', description: 'New versions always start false. Changed only by activation/deactivation.' },
        createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' },
    } },
    RecipeList: { type: 'object', properties: { data: { type: 'array', items: ref('Recipe') },
        pagination: { type: 'object', properties: { page: { type: 'integer' }, limit: { type: 'integer' },
            total: { type: 'integer' }, totalPages: { type: 'integer' } } } } },
    RecipeError: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
};
export const recipePaths = {
    '/api/recipes': {
        post: { tags: ['Recipes'], summary: 'Create an inactive recipe version',
            description: 'Product and Ingredients must exist; Product must support size. Unavailable Product/inactive Ingredients are allowed for drafts. Version is max existing version + 1, initially 1, with at most three attempts for verified version collisions. History remains immutable. Repeated HTTP requests may create additional versions. Both unique Recipe indexes are verified before writes; missing/misconfigured indexes cause 500 and are never automatically created.',
            requestBody: { required: true, content: json(ref('RecipeInput')) }, responses: { '201': single, ...errors } },
        get: { tags: ['Recipes'], summary: 'List all recipe versions, including history',
            description: 'Fixed order: productId ascending, size ascending, version descending, _id ascending. Both activation states included unless filtered. Unknown, repeated, nested, blank and noncanonical query parameters are rejected. Count and records are separate reads and may differ during concurrent writes. References are not populated.',
            parameters: [query('page', { type: 'integer', minimum: 1, default: 1 }, 'Positive safe integer; offset must be safe.'),
                query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'Page size.'),
                query('productId', objectId, 'Exact Product ID.'), query('size', contentProperties.size, 'Exact size.'),
                query('isActive', { type: 'boolean' }, 'Only literal true/false; omitted means both states.')],
            responses: { '200': { description: 'Paginated recipes', content: json(ref('RecipeList')) }, '400': errors['400'], '500': errors['500'] } },
    },
    '/api/recipes/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: objectId }],
        get: { tags: ['Recipes'], summary: 'Retrieve an immutable recipe version',
            description: 'Raw reference IDs are retained even if catalog metadata changes. No query parameters accepted. No PATCH or DELETE endpoint exists.',
            responses: { '200': single, '400': errors['400'], '404': errors['404'], '500': errors['500'] } },
    },
    '/api/recipes/{id}/activate': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: objectId }],
        post: { tags: ['Recipes'], summary: 'Atomically activate a recipe version',
            description: 'Requires transaction-capable MongoDB and both verified unique indexes; no fallback. Product must exist, be available and support the size; all Ingredients must exist and be active. Sequential operations share one session: validate, deactivate previous version, activate target, commit. Already-active valid recipes return 200 unchanged. Snapshot reads, majority commit; at most three callback attempts and a 10-second transaction retry deadline. Concurrent successful requests may serialize; a later commit can replace an earlier selection. Driver retries uncertain commits; unresolved outcomes return sanitized 500 and do not imply rollback. Definite aborts preserve committed state. Catalog validity is checked at the transaction snapshot and is not permanently enforced by other catalog APIs. No query parameters accepted.',
            requestBody: actionBody, responses: { '200': single, ...errors } },
    },
    '/api/recipes/{id}/deactivate': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: objectId }],
        post: { tags: ['Recipes'], summary: 'Idempotently deactivate a recipe version',
            description: 'Conditional single-document update; repeated calls return 200 without another state change. Missing recipe returns 404. No reference availability requirement. Contents and historical versions remain stored. Both unique indexes are verified before mutation. No query parameters accepted.',
            requestBody: actionBody, responses: { '200': single, ...errors } },
    },
};
