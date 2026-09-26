import React, { useRef, useState } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '../components/Icon';
import { Text, IconButton, Button } from '../components/ui';
import { colors, fonts } from '../theme';

const FRAME_W = 264;
const FRAME_H = 220;

// QR codes plus the common linear (1D) product and carton barcodes.
const BARCODE_TYPES = ['qr', 'ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'code93', 'itf14', 'codabar'];

export default function ScanBarcodeScreen({ navigation, route }) {
  const { onScanned } = route.params || {};
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  // A ref, not state: the camera can fire two frames in the same tick, before a state update
  // and re-render land — handleBarcodeScanned's closure would still see the old `scanned`
  // value in that window and could double-fire onScanned. A ref is read/written synchronously
  // with no such gap, so the very first frame reliably wins.
  const scannedRef = useRef(false);

  function handleBarcodeScanned({ data }) {
    if (scannedRef.current) return; // ignore repeat callbacks while the camera keeps sending frames
    scannedRef.current = true;
    navigation.goBack();
    onScanned && onScanned(data);
  }

  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
      <IconButton icon="x" label="Close scanner" variant="onDark" onPress={() => navigation.goBack()} iconSize={22} />
      <Text style={styles.title} accessibilityRole="header">
        Scan item
      </Text>
      {permission?.granted ? (
        <IconButton
          icon="flash"
          label={torch ? 'Turn off flashlight' : 'Turn on flashlight'}
          variant={torch ? 'surface' : 'onDark'}
          onPress={() => setTorch((t) => !t)}
        />
      ) : (
        <View style={{ width: 44 }} />
      )}
    </View>
  );

  if (!permission) {
    return <View style={styles.container} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        {topBar}
        <View style={styles.permission}>
          <View style={styles.permissionIcon}>
            <Icon name="camera" size={28} color="#FFFFFF" />
          </View>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionBody}>Allow camera access to scan item barcodes and QR codes.</Text>
          <Button title="Allow camera access" onPress={requestPermission} style={{ alignSelf: 'stretch', marginTop: 8 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView
        style={StyleSheet.absoluteFillObject}
        enableTorch={torch}
        barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      {topBar}
      <View style={styles.overlay} pointerEvents="none">
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
          <View style={styles.scanLine} />
        </View>
        <Text style={styles.hint}>Align a barcode or QR code within the frame</Text>
      </View>
    </View>
  );
}

const C = 34;
const B = 4;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.camera },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 2, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.semibold, fontSize: 17, color: '#FFFFFF' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 28 },
  frame: { width: FRAME_W, height: FRAME_H },
  corner: { position: 'absolute', width: C, height: C, borderColor: '#FFFFFF' },
  tl: { left: 0, top: 0, borderLeftWidth: B, borderTopWidth: B, borderTopLeftRadius: 14 },
  tr: { right: 0, top: 0, borderRightWidth: B, borderTopWidth: B, borderTopRightRadius: 14 },
  bl: { left: 0, bottom: 0, borderLeftWidth: B, borderBottomWidth: B, borderBottomLeftRadius: 14 },
  br: { right: 0, bottom: 0, borderRightWidth: B, borderBottomWidth: B, borderBottomRightRadius: 14 },
  scanLine: {
    position: 'absolute', left: 14, right: 14, top: FRAME_H / 2 - 1, height: 2, borderRadius: 1, backgroundColor: '#6E88FF',
    shadowColor: '#6E88FF', shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 },
  },
  hint: { fontSize: 15, color: '#C9CEDB', textAlign: 'center', paddingHorizontal: 32 },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  permissionIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  permissionTitle: { fontFamily: fonts.display, fontSize: 24, color: '#FFFFFF', textAlign: 'center' },
  permissionBody: { fontSize: 15, lineHeight: 22, color: '#C9CEDB', textAlign: 'center' },
});
