import { useFocusEffect } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { readCatalogDetailId } from '../navigation/catalog.routes';
import { createRecipeDetailController, createRecipeListController } from './recipe.controller';

const RecipeContext = createContext<ReturnType<typeof createRecipeListController> | undefined>(undefined);

export function RecipeStateProvider({ children }: { children: ReactNode }) {
  const [list] = useState(() => createRecipeListController());
  useEffect(() => () => { list.blur(); }, [list]);
  return <RecipeContext.Provider value={list}>{children}</RecipeContext.Provider>;
}

export function useRecipeList() {
  const list = useContext(RecipeContext);
  if (!list) throw new Error('Recipe screens require RecipeStateProvider.');
  const state = useSyncExternalStore(list.subscribe, list.getSnapshot, list.getSnapshot);
  useFocusEffect(useCallback(() => { void list.focus(); return () => { list.blur(); }; }, [list]));
  return { ...state, updateDraft: list.updateDraft, apply: list.apply, reset: list.reset,
    previousPage: list.previousPage, nextPage: list.nextPage, retry: list.retry, retryProduct: list.retryProduct };
}

export function useRecipeDetail(value: unknown) {
  const id = readCatalogDetailId(value);
  const detail = useMemo(() => createRecipeDetailController(id), [id]);
  const state = useSyncExternalStore(detail.subscribe, detail.getSnapshot, detail.getSnapshot);
  useFocusEffect(useCallback(() => { void detail.focus(); return () => { detail.blur(); }; }, [detail]));
  return { ...state, retry: detail.retry, retryProduct: detail.retryProduct, retryIngredient: detail.retryIngredient };
}
