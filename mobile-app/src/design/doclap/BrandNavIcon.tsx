import React from 'react';
import { Image, type ImageSourcePropType } from 'react-native';
import type { BottomItem } from './navigation';

// Original monochrome PNG line icons. No new icon/font dependency is required.
const icons: Record<BottomItem, ImageSourcePropType> = {
  home: require('./assets/icons/home.png'),
  work: require('./assets/icons/work.png'),
  camera: require('./assets/icons/camera.png'),
  history: require('./assets/icons/history.png'),
  account: require('./assets/icons/account.png'),
};

export function BrandNavIcon(item: BottomItem, color: string, size: number): React.ReactNode {
  return (
    <Image
      source={icons[item]}
      accessibilityIgnoresInvertColors
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  );
}
