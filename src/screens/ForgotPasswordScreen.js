import React, { useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api/client';
import { Text, Screen, NavHeader, Field, Button, Banner, Note } from '../components/ui';
import { colors, fonts } from '../theme';

// Emails a link that opens the Set password screen. The API answers the same way whether or
// not the email has an account, so this screen never reveals which emails are registered.
// A user whose invite was never completed gets a fresh invite link instead.
export default function ForgotPasswordScreen({ navigation, route }) {
  const [email, setEmail] = useState(route.params?.email || '');
  const [submitting, setSubmitting] = useState(false);
  const [sentTo, setSentTo] = useState(null);
  const [error, setError] = useState(null);

  async function handleSubmit() {
    const value = email.trim();
    setError(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      setError('Enter the email address you log in with.');
      return;
    }
    setSubmitting(true);
    try {
      await api.forgotPassword(value);
      setSentTo(value);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  function backToLogin() {
    navigation.reset({ index: 0, routes: [{ name: 'Login', params: { email: email.trim() } }] });
  }

  return (
    <Screen>
      <NavHeader title="" onBack={() => (navigation.canGoBack() ? navigation.goBack() : backToLogin())} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={{ gap: 8 }}>
            <Text style={styles.heading} accessibilityRole="header">
              Forgot password
            </Text>
            <Text style={styles.subtitle}>Enter your work email and we'll send you a link to set a new password.</Text>
          </View>

          {sentTo ? (
            <View style={{ gap: 16 }}>
              <Banner
                kind="ok"
                icon="mail"
                title="Check your email"
                subtitle={`If an account exists for ${sentTo}, we've sent a link. Open it on this phone. It expires in 1 hour.`}
              />
              <Button title="Back to log in" onPress={backToLogin} />
              <Button title="Send again" variant="ghost" height={44} onPress={handleSubmit} loading={submitting} />
            </View>
          ) : (
            <View style={{ gap: 18 }}>
              <Field
                label="Work email"
                leadingIcon="mail"
                placeholder="you@company.com"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="username"
                autoComplete="email"
                returnKeyType="send"
                onSubmitEditing={handleSubmit}
                value={email}
                onChangeText={setEmail}
                error={error}
              />
              <Button title="Send link" onPress={handleSubmit} loading={submitting} />
              <Note>Still waiting to set up your account? This sends you a new invite link.</Note>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, paddingTop: 8, gap: 24 },
  heading: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.7 },
  subtitle: { fontSize: 16, lineHeight: 24, color: colors.ink2 },
});
