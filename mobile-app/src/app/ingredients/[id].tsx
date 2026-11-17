import { useLocalSearchParams } from 'expo-router';
import { IngredientDetailScreen } from '../../ingredients/IngredientScreens';

export default function IngredientDetailRoute() {
  const { id } = useLocalSearchParams();
  return <IngredientDetailScreen id={id} />;
}
