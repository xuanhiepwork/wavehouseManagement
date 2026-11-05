import { useLocalSearchParams } from 'expo-router';
import { CatalogDetailPlaceholder } from '../../navigation/CatalogPlaceholder';

export default function IngredientDetailRoute() {
  const { id } = useLocalSearchParams();
  return <CatalogDetailPlaceholder resource="ingredients" id={id} />;
}
