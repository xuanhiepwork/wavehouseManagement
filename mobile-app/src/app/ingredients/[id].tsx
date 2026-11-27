import { AuthGate } from '../../auth/AuthGate';
import { useLocalSearchParams } from 'expo-router';
import { IngredientDetailScreen } from '../../ingredients/IngredientScreens';

export default function IngredientDetailRoute() {
  const { id } = useLocalSearchParams();
  return <AuthGate><IngredientDetailScreen id={id} /></AuthGate>;
}
