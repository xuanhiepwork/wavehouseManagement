import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  catalogDetailHref, catalogListHref, isCatalogResource, readCatalogDetailId,
} from '../src/navigation/catalog.routes.ts';

const id = '12345678-abcd-1234-1234-123456789abc';
const resources = ['ingredients', 'products', 'recipes'] as const;

describe('Catalog navigation resource boundaries', () => {
  for (const resource of resources) {
    it(`builds only the ${resource} list and UUID detail routes`, () => {
      assert.equal(isCatalogResource(resource), true);
      assert.deepEqual(catalogListHref(resource), { pathname: `/${resource}` });
      assert.deepEqual(catalogDetailHref(resource, id), {
        pathname: `/${resource}/[id]`, params: { id },
      });
    });
  }

  const invalidResources: readonly [string, unknown][] = [
    ['missing', undefined], ['null', null], ['empty', ''], ['singular name', 'ingredient'],
    ['wrong case', 'Products'], ['padded', ' recipes '], ['external URL', 'https://example.test/products'],
    ['path traversal', '../products'], ['nested path', 'products/activate'], ['array', ['products']],
    ['object', { resource: 'products' }], ['prototype key', '__proto__'], ['number', 1],
    ['symbol', Symbol('products')],
  ];
  for (const [label, resource] of invalidResources) {
    it(`rejects an unknown resource (${label}) without inventing a fallback route`, () => {
      assert.equal(isCatalogResource(resource), false);
      assert.equal(catalogListHref(resource), undefined);
      assert.equal(catalogDetailHref(resource, id), undefined);
    });
  }
});

describe('Catalog detail route parameters', () => {
  for (const value of [id, id.toUpperCase()]) {
    it(`preserves the valid singular raw UUID ${value}`, () => {
      assert.equal(readCatalogDetailId(value), value);
      for (const resource of resources) {
        assert.deepEqual(catalogDetailHref(resource, value), {
          pathname: `/${resource}/[id]`, params: { id: value },
        });
      }
    });
  }

  const invalidIds: readonly [string, unknown][] = [
    ['missing', undefined], ['null', null], ['empty', ''], ['Mongo ObjectId', '507f1f77bcf86cd799439011'],
    ['malformed UUID', 'not-a-uuid'], ['leading space', ` ${id}`], ['trailing space', `${id} `],
    ['query suffix', `${id}?activate=true`], ['fragment suffix', `${id}#details`],
    ['path segment', `../${id}`], ['encoded separator', id.replace('-', '%2D')],
    ['empty array', []], ['single-item array', [id]], ['repeated array', [id, id]],
    ['different-value array', [id, id.toUpperCase()]], ['object', { id }], ['number', 123],
  ];
  for (const [label, value] of invalidIds) {
    it(`rejects ${label} parameters before building any detail href`, () => {
      assert.equal(readCatalogDetailId(value), undefined);
      for (const resource of resources) assert.equal(catalogDetailHref(resource, value), undefined);
    });
  }

  it('does not coerce objects or call their string conversion hooks', () => {
    const value = { toString() { throw new Error('Route input must not be coerced'); } };
    assert.equal(readCatalogDetailId(value), undefined);
    assert.equal(catalogDetailHref('recipes', value), undefined);
    assert.equal(isCatalogResource(value), false);
    assert.equal(catalogListHref(value), undefined);
  });
});
