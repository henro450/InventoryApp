import React from 'react';
import { Image, StyleSheet } from 'react-native';
import { LetterTile } from './ui';
import { colors } from '../theme';
import { useItemPhoto } from '../utils/itemPhotos';

// An item's photo when it has one, else its first letter.
export default function ItemThumb({ item, size = 40, muted = false }) {
  const uri = useItemPhoto(item);
  if (!uri) return <LetterTile label={item?.name} size={size} muted={muted} />;
  return (
    <Image
      source={{ uri }}
      accessibilityIgnoresInvertColors
      style={[styles.photo, { width: size, height: size }, muted && styles.muted]}
      resizeMode="cover"
    />
  );
}

const styles = StyleSheet.create({
  photo: { borderRadius: 12, backgroundColor: colors.surfaceMuted },
  muted: { opacity: 0.55 },
});
