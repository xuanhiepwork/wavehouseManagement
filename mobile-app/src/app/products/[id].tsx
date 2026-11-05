import { useLocalSearchParams } from 'expo-router';
import { CatalogDetailPlaceholder } from '../../navigation/CatalogPlaceholder';

export default function ProductDetailRoute() {
  const { id } = useLocalSearchParams();
  return <CatalogDetailPlaceholder resource="products" id={id} />;
}
