import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { readCatalogDetailId } from '../navigation/catalog.routes';
import { createProductDetailController, createProductListController } from './product.controller';

const ProductContext = createContext<ReturnType<typeof createProductListController> | undefined>(undefined);

export function ProductStateProvider({ children }: { children: ReactNode }) {
  const [list] = useState(() => createProductListController());
  // Cancel rather than permanently dispose: React StrictMode may replay setup/cleanup.
  useEffect(() => () => { list.blur(); }, [list]);
  return <ProductContext.Provider value={list}>{children}</ProductContext.Provider>;
}

export function useProductList() {
  const list = useContext(ProductContext);
  if (!list) throw new Error('Product screens require ProductStateProvider.');
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  useFocusEffect(useCallback(() => { void list.focus(); return () => { list.blur(); }; }, [list]));
  return { ...state, updateDraft: list.updateDraft, apply: list.apply, reset: list.reset,
    previousPage: list.previousPage, nextPage: list.nextPage, retry: list.retry };
}

export function useProductDetail(value: unknown) {
  const id = readCatalogDetailId(value);
  // Switching the UUID switches the store during render, so old detail data cannot flash.
  const detail = useMemo(() => createProductDetailController(id), [id]);
  const state = useSyncExternalStore(detail.subscribe, detail.getSnapshot, detail.getSnapshot);
  useFocusEffect(useCallback(() => { void detail.focus(); return () => { detail.blur(); }; }, [detail]));
  return { ...state, retry: detail.retry };
}
