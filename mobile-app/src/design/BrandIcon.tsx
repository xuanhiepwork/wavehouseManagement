import { Image } from 'react-native';

const sources = {
  home: require('../../assets/brand-nav/home.png'),
  work: require('../../assets/brand-nav/work.png'),
  camera: require('../../assets/brand-nav/camera.png'),
  history: require('../../assets/brand-nav/history.png'),
  account: require('../../assets/brand-nav/account.png'),
  sales: require('../../assets/brand-nav/sales.png'),
  receiving: require('../../assets/brand-nav/receiving.png'),
  delivery: require('../../assets/brand-nav/delivery.png'),
  inventory: require('../../assets/brand-nav/inventory.png'),
  schedule: require('../../assets/brand-nav/schedule.png'),
  manager: require('../../assets/brand-nav/manager.png'),
  roster: require('../../assets/brand-nav/roster.png'),
  ingredients: require('../../assets/brand-nav/ingredients.png'),
  products: require('../../assets/brand-nav/products.png'),
  recipes: require('../../assets/brand-nav/recipes.png'),
} as const;

export type BrandIconName = keyof typeof sources;
export function BrandIcon({ name, color, size = 24 }: { name: BrandIconName; color: string; size?: number }) {
  return <Image source={sources[name]} fadeDuration={0} resizeMode="contain"
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ width: size, height: size, tintColor: color }} />;
}
