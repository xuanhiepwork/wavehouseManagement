import { AuthGate } from '../../auth/AuthGate';
import { useLocalSearchParams } from 'expo-router';
import { ProductDetailScreen } from '../../products/ProductScreens';

export default function ProductDetailRoute() {
  const { id } = useLocalSearchParams();
  return <AuthGate><ProductDetailScreen id={id} /></AuthGate>;
}
