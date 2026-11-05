import { isUuid } from '../api/catalog.validation.ts';

export type CatalogResource = 'ingredients' | 'products' | 'recipes';
type CatalogListPathname = '/ingredients' | '/products' | '/recipes';
type CatalogDetailPathname = '/ingredients/[id]' | '/products/[id]' | '/recipes/[id]';

export interface CatalogListHref {
  readonly pathname: CatalogListPathname;
}
export interface CatalogDetailHref {
  readonly pathname: CatalogDetailPathname;
  readonly params: { readonly id: string };
}

const listPaths: Readonly<Record<CatalogResource, CatalogListPathname>> = {
  ingredients: '/ingredients', products: '/products', recipes: '/recipes',
};
const detailPaths: Readonly<Record<CatalogResource, CatalogDetailPathname>> = {
  ingredients: '/ingredients/[id]', products: '/products/[id]', recipes: '/recipes/[id]',
};

export function isCatalogResource(value: unknown): value is CatalogResource {
  return value === 'ingredients' || value === 'products' || value === 'recipes';
}

/** Route arrays are ambiguous, including a one-item array; keep valid raw UUID text. */
export function readCatalogDetailId(value: unknown): string | undefined {
  return isUuid(value) ? value : undefined;
}

export function catalogListHref(resource: unknown): CatalogListHref | undefined {
  return isCatalogResource(resource) ? { pathname: listPaths[resource] } : undefined;
}

export function catalogDetailHref(resource: unknown, id: unknown): CatalogDetailHref | undefined {
  const uuid = readCatalogDetailId(id);
  return isCatalogResource(resource) && uuid
    ? { pathname: detailPaths[resource], params: { id: uuid } }
    : undefined;
}
