import { AuthGate } from '../../auth/AuthGate';
import { RecipeListScreen } from '../../recipes/RecipeScreens';

export default function RecipesRoute() {
  return <AuthGate><RecipeListScreen /></AuthGate>;
}
