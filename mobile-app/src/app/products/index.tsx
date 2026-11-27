import { AuthGate } from '../../auth/AuthGate';
import { ProductListScreen } from '../../products/ProductScreens';

export default function ProductsRoute() {
  return <AuthGate><ProductListScreen /></AuthGate>;
}
