import { AuthGate } from '../../auth/AuthGate';
import { IngredientListScreen } from '../../ingredients/IngredientScreens';

export default function IngredientsRoute() {
  return <AuthGate><IngredientListScreen /></AuthGate>;
}
