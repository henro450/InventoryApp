import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

// Reusable barcode/QR scanner. Callers navigate here with `route.params.onScanned(code)` —
// a plain in-memory callback (React Navigation params aren't required to be serializable
// within the same session) — so each caller decides what a scanned code means (fill a form
// field, look up an existing item) without this screen needing to know about them.
export default function ScanBarcodeScreen({ navigation, route }) {
  const { onScanned } = route.params || {};
  const [permission, requestPermission] = useCameraPermissions();
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

  if (!permission) {
    return <View style={styles.centered} />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.centered}>
        <Text style={styles.message}>Camera access is needed to scan barcodes.</Text>
        <TouchableOpacity style={styles.button} onPress={requestPermission}>
          <Text style={styles.buttonText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'upc_a', 'code128', 'code39'] }}
        onBarcodeScanned={handleBarcodeScanned}
      />
      <View style={styles.overlay}>
        <View style={styles.frame} />
        <Text style={styles.hint}>Align a barcode or QR code within the frame</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fff' },
  message: { textAlign: 'center', marginBottom: 16, fontSize: 14, color: '#333' },
  button: { backgroundColor: '#2f6fed', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: '#fff', fontWeight: '600' },
  overlay: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  frame: { width: 240, height: 240, borderWidth: 2, borderColor: '#fff', borderRadius: 12 },
  hint: { color: '#fff', marginTop: 16, fontSize: 13 },
});
