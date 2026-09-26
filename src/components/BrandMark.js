import React from 'react';
import Svg, { Rect, Polygon } from 'react-native-svg';
import { colors } from '../theme';

// The HenroTech mark: two shelving uprights holding a package, forming an H, on a rounded
// cobalt tile. Same geometry as the logo, app icon and email header. `tile={false}` draws
// just the white glyph (for placing on a coloured background).
export default function BrandMark({ size = 48, tile = true, color = colors.primary }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessibilityLabel="HenroTech">
      {tile && <Rect x="0" y="0" width="100" height="100" rx="24" fill={color} />}
      <Rect x="21" y="21" width="12" height="58" rx="3.5" fill="#FFFFFF" />
      <Rect x="67" y="21" width="12" height="58" rx="3.5" fill="#FFFFFF" />
      <Polygon points="50,35 67,43.5 50,52 33,43.5" fill="#FFFFFF" />
      <Polygon points="33,43.5 50,52 50,69 33,60.5" fill="#FFFFFF" fillOpacity={0.78} />
      <Polygon points="50,52 67,43.5 67,60.5 50,69" fill="#FFFFFF" fillOpacity={0.52} />
    </Svg>
  );
}
