import React, { useEffect, useRef, useState } from 'react';
import { View, ScrollView, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Text, Screen, NavHeader, Field, Button, IconButton, Banner, Note, EmptyState, Loading } from '../components/ui';
import { colors, fonts } from '../theme';

const MIN_PASSWORD_LENGTH = 8;

// Opened from the link in an invite or password-reset email (beams://set-password?token=…).
// Invites also let the new user put in their own name; resets only change the password.
export default function SetPasswordScreen({ navigation, route }) {
  const { user, logout } = useAuth();
  const token = route.params?.token;

  const [info, setInfo] = useState(null); // { purpose, email, name, companyName }
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const confirmRef = useRef(null);
  const passwordRef = useRef(null);

  const isInvite = info?.purpose === 'invite';
  const title = isInvite ? 'Set up your account' : info ? 'Reset password' : 'Set password';

  useEffect(() => {
    if (!token) {
      setLoadError('This link is incomplete. Open the most recent email and tap the button again.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    api
      .getPasswordToken(token)
      .then((data) => {
        setInfo(data);
        // The account's name starts out as the company name until the user sets their own.
        setName(data.name && data.name !== data.companyName ? data.name : '');
      })
      .catch((err) => setLoadError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  function goToLogin(params) {
    navigation.reset({ index: 0, routes: [{ name: 'Login', params }] });
  }

  function handleBack() {
    if (navigation.canGoBack()) navigation.goBack();
    else if (!user) goToLogin();
  }

  async function handleSubmit() {
    setFormError(null);
    if (password.length < MIN_PASSWORD_LENGTH) {
      setFormError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setFormError("The two passwords don't match.");
      return;
    }
    setSubmitting(true);
    try {
      const { email } = await api.setPassword({ token, password, name: isInvite ? name.trim() : undefined });
      goToLogin({ email, notice: isInvite ? 'Your account is ready. Log in with your new password.' : 'Password updated. Log in with your new password.' });
    } catch (err) {
      if (err.status === 410) setLoadError(err.message);
      else setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  let body;
  if (user) {
    body = (
      <View style={{ gap: 16 }}>
        <Banner
          kind="warn"
          title={`You're signed in as ${user.email}`}
          subtitle="Log out first to set a password from this link. Your link will still work afterwards."
        />
        <Button title="Log out" variant="secondary" onPress={logout} />
      </View>
    );
  } else if (loading) {
    body = <Loading />;
  } else if (loadError) {
    body = (
      <EmptyState icon="alert" title="This link can't be used" body={loadError}>
        <Button
          title="Request a new link"
          height={48}
          style={{ marginTop: 8, alignSelf: 'stretch' }}
          onPress={() => navigation.navigate('ForgotPassword', { email: info?.email })}
        />
        <Button title="Back to log in" variant="ghost" height={44} onPress={() => goToLogin()} />
      </EmptyState>
    );
  } else {
    body = (
      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <Text style={styles.heading} accessibilityRole="header">
            {title}
          </Text>
          <Text style={styles.subtitle}>
            {isInvite && info.companyName ? (
              <>
                You've been registered as the administrator of <Text style={styles.strong}>{info.companyName}</Text>.{' '}
              </>
            ) : null}
            Choose a password for <Text style={styles.strong}>{info.email}</Text>.
          </Text>
        </View>

        {isInvite && (
          <Field
            label="Your name"
            leadingIcon="user"
            placeholder="Full name"
            autoCapitalize="words"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            value={name}
            onChangeText={setName}
            optional
          />
        )}
        <Field
          ref={passwordRef}
          label="New password"
          leadingIcon="lock"
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          autoComplete="password-new"
          returnKeyType="next"
          onSubmitEditing={() => confirmRef.current?.focus()}
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
        <Field
          ref={confirmRef}
          label="Confirm password"
          leadingIcon="lock"
          placeholder="Type it again"
          secureTextEntry={!showPassword}
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleSubmit}
          value={confirm}
          onChangeText={setConfirm}
          error={formError}
        />
        <Button title={isInvite ? 'Set password' : 'Update password'} onPress={handleSubmit} loading={submitting} />
        <Note>After this you'll log in with {info.email} and your new password.</Note>
      </View>
    );
  }

  return (
    <Screen>
      <NavHeader title={info && !user && !loadError ? '' : title} onBack={handleBack} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {body}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: 24, paddingTop: 8 },
  heading: { fontFamily: fonts.display, fontSize: 30, lineHeight: 34, letterSpacing: -0.7 },
  subtitle: { fontSize: 16, lineHeight: 24, color: colors.ink2 },
  strong: { fontFamily: fonts.semibold, color: colors.ink },
});
