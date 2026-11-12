const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Types } = require('mongoose');
const { Ingredient } = require('../dist/models/Ingredient');
const { Product } = require('../dist/models/Product');
const { Recipe } = require('../dist/models/Recipe');

const ingredientData = () => ({ code: ' beans ', name: ' Coffee beans ', category: ' Coffee ', unit: 'g', costPrice: 0 });
const productData = () => ({ code: ' latte ', name: ' Latte ', category: ' Coffee ', prices: [{ size: 'M', price: 0 }] });
const recipeData = () => ({ productId: new Types.ObjectId(), size: 'M', ingredients: [{ ingredientId: new Types.ObjectId(), quantity: 0.5 }] });

async function expectInvalid(Model, data, path) {
    await assert.rejects(new Model(data).validate(), error => {
        assert.ok(error.errors[path], `Expected ${path}; received ${Object.keys(error.errors).join(', ')}`);
        return true;
    });
}

test('Ingredient normalizes catalog strings and supplies defaults without global stock', async () => {
    const ingredient = new Ingredient({ ...ingredientData(), currentStock: 100 });
    await ingredient.validate();
    assert.equal(ingredient.code, 'BEANS');
    assert.equal(ingredient.name, 'Coffee beans');
    assert.equal(ingredient.category, 'Coffee');
    assert.equal(ingredient.minStock, 0);
    assert.equal(ingredient.isActive, true);
    assert.equal(Ingredient.schema.path('currentStock'), undefined);
    assert.equal(Object.hasOwn(ingredient.toObject(), 'currentStock'), false);
    assert.equal(new Ingredient({ ...ingredientData(), isActive: false }).isActive, false);
    for (const unit of ['g', 'ml', 'piece']) {
        await new Ingredient({ ...ingredientData(), unit }).validate();
    }
});

test('required catalog fields reject omission, null and whitespace-only strings', async () => {
    for (const [Model, data] of [[Ingredient, ingredientData], [Product, productData]]) {
        for (const field of ['code', 'name', 'category']) {
            for (const value of [undefined, null, '', '   ']) {
                await expectInvalid(Model, { ...data(), [field]: value }, field);
            }
        }
    }
    for (const value of [undefined, null, 'kg', '']) {
        await expectInvalid(Ingredient, { ...ingredientData(), unit: value }, 'unit');
    }
});

test('Ingredient costs and thresholds reject non-finite, negative and missing values', async () => {
    for (const field of ['costPrice', 'minStock']) {
        for (const value of [NaN, Infinity, -Infinity, -1, -0.1, null, 'invalid']) {
            await expectInvalid(Ingredient, { ...ingredientData(), [field]: value }, field);
        }
        for (const value of [0, 0.5, 100]) {
            await new Ingredient({ ...ingredientData(), [field]: value }).validate();
        }
    }
    await expectInvalid(Ingredient, { ...ingredientData(), costPrice: undefined }, 'costPrice');
});

test('Product normalizes strings, keeps optional metadata and supports each size', async () => {
    const product = new Product({
        ...productData(), description: ' Fresh coffee ', imageUrl: ' https://example.com/latte.png ',
        prices: ['S', 'M', 'L'].map(size => ({ size, price: 12.5 })),
    });
    await product.validate();
    assert.equal(product.code, 'LATTE');
    assert.equal(product.name, 'Latte');
    assert.equal(product.category, 'Coffee');
    assert.equal(product.description, 'Fresh coffee');
    assert.equal(product.imageUrl, 'https://example.com/latte.png');
    assert.equal(product.isAvailable, true);
    assert.equal(product.prices[0]._id, undefined);
    assert.equal(new Product(productData()).description, undefined);
    assert.equal(new Product({ ...productData(), isAvailable: false }).isAvailable, false);
});

test('Product requires a non-empty array with distinct, non-null price entries', async () => {
    for (const prices of [undefined, null, [], [null], [{ size: 'M', price: 1 }, { size: 'M', price: 2 }]]) {
        await expectInvalid(Product, { ...productData(), prices }, 'prices');
    }
    for (const size of [undefined, null, 'XL', 'm']) {
        await expectInvalid(Product, { ...productData(), prices: [{ size, price: 1 }] }, 'prices.0.size');
    }
});

test('Product rejects invalid price numbers while allowing zero and decimals', async () => {
    for (const price of [undefined, null, NaN, Infinity, -Infinity, -1, -0.1, 'invalid']) {
        await expectInvalid(Product, { ...productData(), prices: [{ size: 'M', price }] }, 'prices.0.price');
    }
    for (const price of [0, 0.5, 100]) {
        await new Product({ ...productData(), prices: [{ size: 'M', price }] }).validate();
    }
});

test('Recipe supplies defaults, casts references and permits inactive historical versions', async () => {
    const data = recipeData();
    const recipe = new Recipe({ ...data, productId: data.productId.toHexString() });
    await recipe.validate();
    assert.ok(recipe.productId instanceof Types.ObjectId);
    assert.equal(recipe.version, 1);
    assert.equal(recipe.isActive, true);
    assert.equal(recipe.ingredients[0]._id, undefined);
    for (const version of [1, 2, 3]) {
        const historical = new Recipe({ ...data, version, isActive: false });
        await historical.validate();
        assert.equal(historical.isActive, false);
    }
});

test('Recipe requires valid ObjectIds and supported sizes', async () => {
    for (const productId of [undefined, null, 'invalid', '123456789012', 12]) {
        await expectInvalid(Recipe, { ...recipeData(), productId }, 'productId');
    }
    for (const ingredientId of [undefined, null, 'invalid', '123456789012', 12]) {
        await expectInvalid(Recipe, { ...recipeData(), ingredients: [{ ingredientId, quantity: 1 }] }, 'ingredients.0.ingredientId');
    }
    for (const size of [undefined, null, 'XL', 'm']) {
        await expectInvalid(Recipe, { ...recipeData(), size }, 'size');
    }
    assert.equal(Recipe.schema.path('productId').options.ref, 'Product');
    assert.equal(Recipe.schema.path('ingredients').schema.path('ingredientId').options.ref, 'Ingredient');
});

test('Recipe requires non-empty, non-null entries and detects equivalent duplicate ObjectIds', async () => {
    for (const ingredients of [undefined, null, [], [null]]) {
        await expectInvalid(Recipe, { ...recipeData(), ingredients }, 'ingredients');
    }
    const ingredientId = new Types.ObjectId();
    await expectInvalid(Recipe, { ...recipeData(), ingredients: [
        { ingredientId, quantity: 1 },
        { ingredientId: ingredientId.toHexString().toUpperCase(), quantity: 2 },
    ] }, 'ingredients');
    await new Recipe({ ...recipeData(), ingredients: [
        { ingredientId, quantity: 1 },
        { ingredientId: new Types.ObjectId(), quantity: 2 },
    ] }).validate();
});

test('Recipe quantities are strictly positive finite numbers', async () => {
    for (const quantity of [undefined, null, 0, -0, -1, -0.1, NaN, Infinity, -Infinity, 'invalid']) {
        const data = recipeData();
        data.ingredients[0].quantity = quantity;
        await expectInvalid(Recipe, data, 'ingredients.0.quantity');
    }
    await new Recipe(recipeData()).validate();
});

test('Recipe versions are positive integers and default only when undefined', async () => {
    for (const version of [null, 0, -1, 0.5, 1.5, NaN, Infinity, -Infinity, 'invalid']) {
        await expectInvalid(Recipe, { ...recipeData(), version }, 'version');
    }
    for (const version of [1, 2, 100]) {
        await new Recipe({ ...recipeData(), version }).validate();
    }
    assert.equal(new Recipe({ ...recipeData(), version: undefined }).version, 1);
});

test('all models configure timestamps and reject explicit null status flags', async () => {
    for (const [Model, data, flag] of [
        [Ingredient, ingredientData, 'isActive'],
        [Product, productData, 'isAvailable'],
        [Recipe, recipeData, 'isActive'],
    ]) {
        assert.equal(Model.schema.options.timestamps, true);
        assert.equal(Model.schema.path('createdAt').instance, 'Date');
        assert.equal(Model.schema.path('updatedAt').instance, 'Date');
        await expectInvalid(Model, { ...data(), [flag]: null }, flag);
    }
});

// These assertions verify declarations only, not enforcement by a live MongoDB server.
test('catalog code indexes are unique and recipe indexes preserve version history', () => {
    for (const Model of [Ingredient, Product]) {
        const indexes = Model.schema.indexes();
        assert.equal(indexes.length, 1);
        assert.deepEqual(indexes[0][0], { code: 1 });
        assert.equal(indexes[0][1].unique, true);
    }
    const indexes = Recipe.schema.indexes();
    assert.equal(indexes.length, 2);
    const versionIndex = indexes.find(([keys]) => Object.hasOwn(keys, 'version'));
    assert.deepEqual(versionIndex[0], { productId: 1, size: 1, version: 1 });
    assert.equal(versionIndex[1].unique, true);
    assert.equal(versionIndex[1].partialFilterExpression, undefined);
    const activeIndex = indexes.find(([keys]) => !Object.hasOwn(keys, 'version'));
    assert.deepEqual(activeIndex[0], { productId: 1, size: 1 });
    assert.equal(activeIndex[1].unique, true);
    assert.deepEqual(activeIndex[1].partialFilterExpression, { isActive: true });
    assert.equal(indexes.some(([, options]) => options.expireAfterSeconds !== undefined), false);
});
