import { useLocalSearchParams } from 'expo-router';
import { ProductDetailScreen } from '../../products/ProductScreens';

export default function ProductDetailRoute() {
  const { id } = useLocalSearchParams();
  return <ProductDetailScreen id={id} />;
}
