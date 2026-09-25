import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import Icon from '../components/Icon';
import { Text, Field, Button, IconButton, Banner } from '../components/ui';
import { colors, fonts, type } from '../theme';

// route.params.email / route.params.notice are set after a password is set from an emailed
// link, so the user lands here with their email filled in and a confirmation banner.
export default function LoginScreen({ navigation, route }) {
  const { login } = useAuth();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState(route.params?.email || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const passwordRef = useRef(null);
  const notice = route.params?.notice;

  useEffect(() => {
    if (route.params?.email) setEmail(route.params.email);
  }, [route.params?.email]);

  async function handleLogin() {
    if (!email || !password) {
      Alert.alert('Missing info', 'Please enter both email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email, password);
      // Navigation switches automatically once `user` is set in AuthContext.
    } catch (err) {
      Alert.alert('Login failed', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brand}>
          <View style={styles.brandTile}>
            <Icon name="logo" size={20} color="#FFFFFF" />
          </View>
          <Text style={styles.brandName}>Inventory</Text>
        </View>

        <View style={styles.intro}>
          <Text style={styles.heading} accessibilityRole="header">
            Welcome back
          </Text>
          <Text style={styles.subtitle}>Sign in to your company account to manage stock, prices and reports.</Text>
        </View>

        <View style={styles.form}>
          {notice ? <Banner kind="ok" icon="check" title={notice} /> : null}
          <Field
            label="Work email"
            leadingIcon="mail"
            placeholder="you@company.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="username"
            autoComplete="email"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            value={email}
            onChangeText={setEmail}
          />
          <Field
            ref={passwordRef}
            label="Password"
            leadingIcon="lock"
            placeholder="Enter your password"
            secureTextEntry={!showPassword}
            textContentType="password"
            autoComplete="password"
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            value={password}
            onChangeText={setPassword}
            trailing={
              <IconButton
                icon={showPassword ? 'eyeoff' : 'eye'}
                label={showPassword ? 'Hide password' : 'Show password'}
                variant="ghost"
                size={40}
                onPress={() => setShowPassword((v) => !v)}
              />
            }
          />
          <Pressable
            accessibilityRole="button"
            onPress={() => navigation.navigate('ForgotPassword', { email: email.trim() })}
            hitSlop={8}
            style={styles.forgot}
          >
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
          <Button title="Log in" onPress={handleLogin} loading={submitting} />
        </View>

        <View style={styles.offline}>
          <Icon name="cloud" size={20} color={colors.ok} />
          <Text style={styles.offlineText}>
            After your first sign-in you can keep working offline. Your session stays cached on this device.
          </Text>
        </View>

        <Text style={styles.footer}>
          New company? Your administrator registers you, and you'll get an email to set your password.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.ground },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandTile: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontFamily: fonts.display, fontSize: 20, letterSpacing: -0.4 },
  intro: { marginTop: 56, gap: 10 },
  heading: { fontFamily: fonts.display, fontSize: 36, lineHeight: 40, letterSpacing: -0.9 },
  subtitle: { fontSize: 16, lineHeight: 24, color: colors.ink2 },
  form: { marginTop: 32, gap: 18 },
  forgot: { alignSelf: 'flex-end', marginTop: -6 },
  forgotText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  offline: {
    marginTop: 22, flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  offlineText: { ...type.small, flex: 1 },
  footer: { marginTop: 'auto', paddingTop: 28, textAlign: 'center', ...type.caption, lineHeight: 18 },
});
