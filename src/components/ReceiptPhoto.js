import React, { useEffect, useState } from 'react';
import { View, Image, Pressable, Modal, StyleSheet, ActivityIndicator } from 'react-native';
import { receiptImageSource } from '../utils/receiptPhotos';
import { Text, IconButton } from './ui';
import { colors, type } from '../theme';

// A money-out entry's receipt photo: this phone's copy if it has one, else the server's. Tap to
// see it full screen.
export default function ReceiptPhoto({ outflow }) {
  const [source, setSource] = useState(undefined); // undefined = loading, null = none
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setFailed(false);
    setSource(undefined);
    receiptImageSource(outflow).then((s) => live && setSource(s), () => live && setSource(null));
    return () => {
      live = false;
    };
  }, [outflow.clientOutflowId, outflow.receiptUri, outflow.receiptMimeType]);

  if (source === null) return null;
  if (source === undefined) {
    return (
      <View style={[styles.frame, styles.center]}>
        <ActivityIndicator color={colors.ink3} />
      </View>
    );
  }
  if (failed) {
    return (
      <View style={[styles.frame, styles.center]}>
        <Text style={type.small}>Couldn't load the receipt photo. Connect to the internet to see it.</Text>
      </View>
    );
  }
  return (
    <>
      <Pressable accessibilityRole="imagebutton" accessibilityLabel="Receipt photo. Opens full screen" onPress={() => setOpen(true)}>
        <Image source={source} style={styles.frame} resizeMode="cover" onError={() => setFailed(true)} />
      </Pressable>
      <Modal visible={open} animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent>
        <View style={styles.full}>
          <Image source={source} style={StyleSheet.absoluteFill} resizeMode="contain" />
          <View style={styles.close}>
            <IconButton icon="x" label="Close receipt photo" variant="muted" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  frame: { width: '100%', height: 180, borderRadius: 14, backgroundColor: colors.surfaceMuted },
  center: { alignItems: 'center', justifyContent: 'center', padding: 16 },
  full: { flex: 1, backgroundColor: '#000000' },
  close: { position: 'absolute', top: 52, right: 20 },
});
