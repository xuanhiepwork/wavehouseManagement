import { useLocalSearchParams } from 'expo-router';
import { CatalogDetailPlaceholder } from '../../navigation/CatalogPlaceholder';

export default function RecipeDetailRoute() {
  const { id } = useLocalSearchParams();
  return <CatalogDetailPlaceholder resource="recipes" id={id} />;
}
