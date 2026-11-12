import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { readCatalogDetailId } from '../navigation/catalog.routes';
import { createIngredientDetailController, createIngredientListController } from './ingredient.controller';

const IngredientContext = createContext<ReturnType<typeof createIngredientListController> | undefined>(undefined);

export function IngredientStateProvider({ children }: { children: ReactNode }) {
  const [list] = useState(() => createIngredientListController());
  // Cancel rather than permanently dispose: React StrictMode may replay setup/cleanup.
  useEffect(() => () => { list.blur(); }, [list]);
  return <IngredientContext.Provider value={list}>{children}</IngredientContext.Provider>;
}

export function useIngredientList() {
  const list = useContext(IngredientContext);
  if (!list) throw new Error('Ingredient screens require IngredientStateProvider.');
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  useFocusEffect(useCallback(() => { void list.focus(); return () => { list.blur(); }; }, [list]));
  return { ...state, updateDraft: list.updateDraft, apply: list.apply, reset: list.reset,
    previousPage: list.previousPage, nextPage: list.nextPage, retry: list.retry };
}

export function useIngredientDetail(value: unknown) {
  const id = readCatalogDetailId(value);
  // Switching the UUID switches the store during render, so old detail data cannot flash.
  const detail = useMemo(() => createIngredientDetailController(id), [id]);
  const state = useSyncExternalStore(detail.subscribe, detail.getSnapshot, detail.getSnapshot);
  useFocusEffect(useCallback(() => { void detail.focus(); return () => { detail.blur(); }; }, [detail]));
  return { ...state, retry: detail.retry };
}
