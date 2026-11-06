import { useLocalSearchParams } from 'expo-router';
import { RecipeDetailScreen } from '../../recipes/RecipeScreens';

export default function RecipeDetailRoute() {
  const { id } = useLocalSearchParams();
  return <RecipeDetailScreen id={id} />;
}
