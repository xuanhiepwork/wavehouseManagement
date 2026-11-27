import React from 'react';
import { BrandExperiencePreview } from '../design/doclap/BrandExperiencePreview';

// Development-only route; does not alter existing authentication, tabs or business navigation.
export default function DocLapPreviewRoute() {
  if (!__DEV__) return null;
  return <BrandExperiencePreview />;
}
