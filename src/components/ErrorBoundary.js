import React from 'react';
import { View, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { reportError } from '../utils/errorReporting';
import { Text, Button } from './ui';
import { colors, fonts, type } from '../theme';

// Last line of defence for a screen that crashes while drawing: instead of a blank or closed app,
// the user sees a short message and can start again. The error is reported (see errorReporting.js).
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    reportError(error, { fatal: true, boundary: true, component: String(info?.componentStack || '').trim().split('\n')[0]?.slice(0, 120) });
  }

  restart = () => {
    // A full reload clears whatever state caused the crash; without expo-updates, remount.
    if (Updates.isEnabled) Updates.reloadAsync().catch(() => this.setState({ failed: false }));
    else this.setState({ failed: false });
  };

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={[type.body, styles.body]}>
          The app hit a problem and has been reset. Your saved work is safe on this phone. We've been told about it.
        </Text>
        <Button title="Start again" onPress={this.restart} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.ground, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 14 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink, textAlign: 'center' },
  body: { textAlign: 'center', color: colors.ink2 },
});
