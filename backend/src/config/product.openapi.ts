const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema: object) => ({ 'application/json': { schema } });
const error = (description: string) => ({ description, content: json(ref('ProductError')) });
const badRequest = error('Invalid request');
const serverError = error('Internal server error');
const readErrors = { '400': badRequest, '404': error('Product not found'), '500': serverError };
const writeErrors = { ...readErrors, '409': error('Product code already exists') };
const optionalString = {
    type: 'string', description: 'Trimmed. Omitted on PATCH: preserved. Empty/whitespace-only: stored as empty string. Null is rejected.',
};
const properties = {
    code: { type: 'string', minLength: 1, description: 'Nonblank; trimmed and uppercased. Unique across available and unavailable products.' },
    name: { type: 'string', minLength: 1, description: 'Nonblank; trimmed.' },
    category: { type: 'string', minLength: 1, description: 'Nonblank; trimmed.' },
    description: optionalString,
    imageUrl: { ...optionalString, description: `${optionalString.description} No URL-format restriction.` },
    prices: { type: 'array', minItems: 1, maxItems: 3, items: ref('ProductPrice'),
        description: 'Each S/M/L size can occur only once. PATCH replaces the complete array; all supplied entries are validated.' },
    isAvailable: { type: 'boolean', default: true, description: 'Only actual booleans accepted. May reactivate an unavailable product.' },
};
const single = { description: 'Product', content: json({ type: 'object', required: ['data'], properties: { data: ref('Product') } }) };
const body = (name: string) => ({ required: true, content: json(ref(name)) });
const query = (name: string, schema: object, description: string) => ({ name, in: 'query', schema, description });

export const productSchemas = {
    ProductPrice: { type: 'object', additionalProperties: false, required: ['size', 'price'], properties: {
        size: { type: 'string', enum: ['S', 'M', 'L'] },
        price: { type: 'number', minimum: 0, description: 'Finite nonnegative JSON number. Strings, null, NaN and Infinity are rejected.' },
    } },
    ProductInput: { type: 'object', additionalProperties: false, required: ['code', 'name', 'category', 'prices'], properties },
    ProductPatch: { type: 'object', additionalProperties: false, minProperties: 1, properties,
        description: 'Omitted fields retain their values. Unknown fields, IDs, timestamps, __v, update operators and dotted paths are rejected.' },
    Product: { type: 'object', properties: { ...properties, _id: { type: 'string' }, __v: { type: 'integer' },
        createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } } },
    ProductList: { type: 'object', required: ['data', 'pagination'], properties: {
        data: { type: 'array', items: ref('Product') },
        pagination: { type: 'object', required: ['page', 'limit', 'total', 'totalPages'], properties: {
            page: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 },
            total: { type: 'integer', minimum: 0 }, totalPages: { type: 'integer', minimum: 0 },
        } },
    } },
    ProductError: { type: 'object', required: ['error'], properties: { error: { type: 'string' } } },
};

export const productPaths = {
    '/api/products': {
        post: { tags: ['Products'], summary: 'Create a product', requestBody: body('ProductInput'),
            responses: { '201': single, '400': badRequest, '409': writeErrors['409'], '500': serverError } },
        get: { tags: ['Products'], summary: 'List products',
            description: 'Includes both available and unavailable products unless filtered. Fixed sorting: code ascending, then _id ascending. Unknown, repeated, nested, and empty query values are rejected. Records and count are separate reads and may differ during concurrent writes.',
            parameters: [
                query('page', { type: 'integer', minimum: 1, default: 1 }, 'Canonical positive safe integer; offset must also be a safe integer.'),
                query('limit', { type: 'integer', minimum: 1, maximum: 100, default: 20 }, 'Page size; canonical positive integer.'),
                query('search', { type: 'string', minLength: 1 }, 'Trimmed, literal case-insensitive substring of code or name.'),
                query('category', { type: 'string', minLength: 1 }, 'Exact trimmed category; case-sensitive.'),
                query('isAvailable', { type: 'boolean' }, 'Only literal true or false. Omitted: both states.'),
            ], responses: { '200': { description: 'Paginated products', content: json(ref('ProductList')) },
                '400': badRequest, '500': serverError } },
    },
    '/api/products/{id}': {
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } }],
        get: { tags: ['Products'], summary: 'Get a product, including unavailable products', responses: { '200': single, ...readErrors } },
        patch: { tags: ['Products'], summary: 'Update supplied product fields',
            description: 'Loads the document, assigns validated fields, and saves with schema validation and normalization.',
            requestBody: body('ProductPatch'), responses: { '200': single, ...writeErrors } },
        delete: { tags: ['Products'], summary: 'Soft-delete a product',
            description: 'Sets isAvailable=false and returns the document. Repeated deletion returns 200 without another save. The document remains retrievable and its code remains reserved.',
            responses: { '200': single, ...writeErrors } },
    },
};

// Production uniqueness requires the declared MongoDB unique code index to exist.
// Deployment tooling must provision it when Mongoose autoIndex is disabled.
