import React, { useState } from 'react';
import {
  View,
  Text as RNText,
  TextInput,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Icon from './Icon';
import { colors, fonts, radius, type, shadow } from '../theme';
import { initials, dateToYmd, ymdToDate, formatYmd } from '../utils/format';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useAuth } from '../context/AuthContext';

// The shared component kit. Screens compose these instead of styling raw React Native views,
// which keeps spacing, type and colour consistent across the app.

export function Text({ style, ...props }) {
  return <RNText {...props} style={[styles.text, style]} />;
}

export function Screen({ children, style }) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function LargeHeader({ eyebrow, title, right }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.largeHeader, { paddingTop: insets.top + 14 }]}>
      <View style={{ flex: 1, gap: 4 }}>
        {eyebrow ? (
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        ) : null}
        <Text style={type.title} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {right ? <View style={styles.headerActions}>{right}</View> : null}
    </View>
  );
}

export function NavHeader({ title, right, onBack, dark = false, showBack = true }) {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const fg = dark ? '#FFFFFF' : colors.ink;
  return (
    <View style={[styles.navHeader, { paddingTop: insets.top + 6 }]}>
      <View style={styles.navSide}>
        {showBack && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onBack || (() => navigation.goBack())}
            hitSlop={6}
            style={({ pressed }) => [styles.navBack, pressed && { opacity: 0.5 }]}
          >
            <Icon name="back" size={24} color={fg} />
          </Pressable>
        )}
      </View>
      <Text style={[styles.navTitle, { color: fg }]} numberOfLines={1} accessibilityRole="header">
        {title}
      </Text>
      <View style={[styles.navSide, { alignItems: 'flex-end' }]}>{right}</View>
    </View>
  );
}

export function IconButton({ icon, label, onPress, variant = 'surface', size = 44, dot = false, disabled = false, iconSize = 20 }) {
  const v = {
    surface: { bg: colors.surface, fg: colors.ink, border: colors.line },
    ghost: { bg: 'transparent', fg: colors.ink, border: 'transparent' },
    muted: { bg: colors.ground, fg: colors.ink, border: colors.ground },
    outline: { bg: colors.surface, fg: colors.ink, border: colors.lineStrong },
    soft: { bg: colors.primarySoft, fg: colors.primary, border: colors.primarySoft },
    dark: { bg: colors.ink, fg: '#FFFFFF', border: colors.ink },
    onDark: { bg: 'rgba(255,255,255,0.14)', fg: '#FFFFFF', border: 'transparent' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.iconButton,
        {
          width: size,
          height: size,
          borderRadius: variant === 'outline' || variant === 'muted' ? 12 : size / 2,
          backgroundColor: v.bg,
          borderColor: v.border,
          opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
        },
      ]}
    >
      <Icon name={icon} size={iconSize} color={v.fg} />
      {dot && <View style={styles.dot} />}
    </Pressable>
  );
}

export function AccountButton({ user, onLogout }) {
  const { fingerprintEnabled, turnOffFingerprint, isCompanyAdmin, isSuperAdmin } = useAuth();
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Account: ${user?.name || 'you'}`}
      onPress={() =>
        Alert.alert(user?.name || 'Account', user?.email || '', [
          { text: 'Cancel', style: 'cancel' },
          ...(isCompanyAdmin && !isSuperAdmin
            ? [
                { text: 'Subscription', onPress: () => navigation.navigate('Subscription') },
                { text: 'Manage users', onPress: () => navigation.navigate('CompanyUsers') },
              ]
            : []),
          ...(fingerprintEnabled ? [{ text: 'Turn off fingerprint login', onPress: turnOffFingerprint }] : []),
          { text: 'Log out', style: 'destructive', onPress: onLogout },
        ])
      }
      style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.avatarText}>{initials(user?.name)}</Text>
    </Pressable>
  );
}

const BUTTON_VARIANTS = {
  primary: { bg: colors.primary, fg: '#FFFFFF', border: colors.primary },
  dark: { bg: colors.ink, fg: '#FFFFFF', border: colors.ink },
  secondary: { bg: colors.surface, fg: colors.ink, border: colors.lineStrong },
  danger: { bg: colors.surface, fg: colors.danger, border: '#EBC5C0' },
  ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
};

export function Button({ title, onPress, variant = 'primary', icon, loading = false, disabled = false, height = 54, style, textStyle }) {
  const v = BUTTON_VARIANTS[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        { height, backgroundColor: v.bg, borderColor: v.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={v.fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={20} color={v.fg} strokeWidth={2} /> : null}
          <Text style={[styles.buttonText, { color: v.fg }, textStyle]}>{title}</Text>
        </>
      )}
    </Pressable>
  );
}

export const Field = React.forwardRef(function Field(
  { label, optional, hint, error, leadingIcon, prefix, trailing, mono, style, inputStyle, ...inputProps },
  ref
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? (
        <View style={styles.fieldLabelRow}>
          <Text style={type.label}>{label}</Text>
          {optional ? <Text style={styles.optional}>Optional</Text> : null}
        </View>
      ) : null}
      <View
        style={[
          styles.inputBox,
          focused && styles.inputBoxFocused,
          error && { borderColor: colors.danger },
          inputProps.editable === false && { backgroundColor: colors.surfaceMuted },
        ]}
      >
        {leadingIcon ? <Icon name={leadingIcon} size={20} color={colors.ink3} /> : null}
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={inputProps.accessibilityLabel || label}
          {...inputProps}
          onFocus={(e) => {
            setFocused(true);
            inputProps.onFocus && inputProps.onFocus(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            inputProps.onBlur && inputProps.onBlur(e);
          }}
          style={[styles.input, mono && { fontFamily: fonts.mono }, inputStyle]}
        />
        {trailing}
      </View>
      {error ? <Text style={styles.fieldError}>{error}</Text> : hint ? <Text style={type.caption}>{hint}</Text> : null}
    </View>
  );
});

// A date field that opens a calendar instead of taking typed text. value/onChange use
// 'YYYY-MM-DD' (or '' for no date). Android shows the system calendar dialog; iOS shows an inline
// calendar in a sheet. minimumDate/maximumDate are also 'YYYY-MM-DD'.
export function DateField({ label, value, onChange, placeholder = 'Choose date', minimumDate, maximumDate, style }) {
  const [iosOpen, setIosOpen] = useState(false);
  const [iosDate, setIosDate] = useState(new Date());
  const current = value ? ymdToDate(value) : maximumDate ? ymdToDate(maximumDate) : new Date();
  const limits = {
    minimumDate: minimumDate ? ymdToDate(minimumDate) : undefined,
    maximumDate: maximumDate ? ymdToDate(maximumDate) : undefined,
  };

  function open() {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: current,
        mode: 'date',
        ...limits,
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(dateToYmd(date));
        },
      });
    } else {
      setIosDate(current);
      setIosOpen(true);
    }
  }

  return (
    <View style={[{ gap: 8 }, style]}>
      {label ? <Text style={type.label}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label || 'Date'}: ${value ? formatYmd(value) : 'not set'}. Opens calendar`}
        onPress={open}
        style={({ pressed }) => [styles.inputBox, pressed && styles.inputBoxFocused]}
      >
        <Icon name="calendar" size={20} color={colors.ink3} />
        <Text style={[styles.input, { paddingVertical: 0 }, !value && { color: colors.placeholder }]} numberOfLines={1}>
          {value ? formatYmd(value) : placeholder}
        </Text>
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label || 'date'}`} hitSlop={10} onPress={() => onChange('')}>
            <Icon name="x" size={18} color={colors.ink3} />
          </Pressable>
        ) : null}
      </Pressable>
      {Platform.OS === 'ios' && (
        <Sheet
          visible={iosOpen}
          onClose={() => setIosOpen(false)}
          title={label || 'Choose date'}
          footer={
            <>
              <Button title="Cancel" variant="secondary" style={{ flex: 1 }} onPress={() => setIosOpen(false)} />
              <Button
                title="Done"
                style={{ flex: 1 }}
                onPress={() => {
                  onChange(dateToYmd(iosDate));
                  setIosOpen(false);
                }}
              />
            </>
          }
        >
          <DateTimePicker value={iosDate} mode="date" display="inline" {...limits} onChange={(e, date) => date && setIosDate(date)} />
        </Sheet>
      )}
    </View>
  );
}

export function SearchField({ value, onChangeText, placeholder }) {
  return (
    <View style={styles.search}>
      <Icon name="search" size={20} color={colors.ink3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={[styles.input, { fontSize: 15 }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
          <Icon name="x" size={18} color={colors.ink3} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({ label, count, active = false, icon, onPress, onClear }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && { opacity: 0.75 }]}
    >
      {icon ? <Icon name={icon} size={16} color={active ? '#FFFFFF' : colors.ink2} strokeWidth={2} /> : null}
      <Text style={[styles.chipText, active && { color: '#FFFFFF' }]}>{label}</Text>
      {count != null ? <Text style={[styles.chipCount, active && { color: '#C3C7D2' }]}>{count}</Text> : null}
      {onClear ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Clear ${label}`} onPress={onClear} hitSlop={8}>
          <Icon name="x" size={14} color={active ? '#FFFFFF' : colors.ink2} strokeWidth={2.2} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const PILL_KINDS = {
  ok: [colors.okSoft, colors.ok],
  warn: [colors.warnSoft, colors.warn],
  danger: [colors.dangerSoft, colors.danger],
  primary: [colors.primarySoft, colors.primary],
  muted: [colors.muted, colors.ink2],
};

export function Pill({ kind = 'muted', label, icon }) {
  const [bg, fg] = PILL_KINDS[kind];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      {icon ? <Icon name={icon} size={14} color={fg} strokeWidth={2.2} /> : <View style={[styles.pillDot, { backgroundColor: fg }]} />}
      <Text style={[styles.pillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

export function CountBadge({ count, kind = 'danger' }) {
  const [bg, fg] = PILL_KINDS[kind];
  return (
    <View style={[styles.countBadge, { backgroundColor: bg }]}>
      <Text style={[styles.countBadgeText, { color: fg }]}>{count}</Text>
    </View>
  );
}

export function Card({ children, style, padding = 16, gap = 12 }) {
  return <View style={[styles.card, { padding, gap }, style]}>{children}</View>;
}

export function ListCard({ children, style }) {
  return <View style={[styles.card, { overflow: 'hidden' }, style]}>{children}</View>;
}

export function Divider({ style }) {
  return <View style={[styles.divider, style]} />;
}

export function SectionTitle({ title, badge, action, onAction, right }) {
  return (
    <View style={styles.sectionTitle}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 }}>
        <Text style={type.heading} accessibilityRole="header">
          {title}
        </Text>
        {badge}
      </View>
      {right}
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={10} style={styles.sectionAction}>
          <Text style={styles.link}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Segmented({ options, value, onChange, accessibilityLabel }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(o.key)}
            style={[styles.segment, active && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, active && { color: colors.ink }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function LetterTile({ label, muted = false, size = 40 }) {
  return (
    <View style={[styles.tile, { width: size, height: size, backgroundColor: muted ? '#F1F0EC' : colors.muted }]}>
      <Text style={[styles.tileText, muted && { color: '#8C909A' }]}>{String(label || '?').trim().charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export function KV({ label, value, valueColor = colors.ink, strong = false }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, strong && { fontSize: 16 }, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

export function Stat({ label, value, align = 'left' }) {
  return (
    <View style={{ gap: 2, flex: 1, alignItems: align === 'right' ? 'flex-end' : 'flex-start' }}>
      <Text style={type.caption}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export function Stepper({ value, onChange, label, big = false, focusedRing = false, decimal = false }) {
  const num = Number(value) || 0;
  const step = (d) => onChange(String(Math.max(0, num + d)));
  const btnSize = big ? 52 : 52;
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={type.label}>{label}</Text> : null}
      <View style={[styles.stepper, big && styles.stepperBig, focusedRing && styles.inputBoxFocused]}>
        <IconButton icon="minus" label={`Decrease ${label || 'value'}`} variant="muted" size={btnSize} onPress={() => step(-1)} disabled={num <= 0} />
        <TextInput
          value={String(value)}
          onChangeText={(t) => onChange(t.replace(decimal ? /[^0-9.]/g : /[^0-9]/g, ''))}
          keyboardType={decimal ? 'decimal-pad' : 'number-pad'}
          placeholder="0"
          placeholderTextColor={colors.placeholder}
          accessibilityLabel={label}
          selectTextOnFocus
          style={[styles.stepperInput, big && { fontSize: 32 }]}
        />
        <IconButton icon="plus" label={`Increase ${label || 'value'}`} variant="muted" size={btnSize} onPress={() => step(1)} />
      </View>
    </View>
  );
}

export function BottomBar({ children }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.bottomBar, { paddingBottom: Math.max(insets.bottom, 14) + 6 }]}>{children}</View>;
}

const BANNER_KINDS = {
  warn: { bg: colors.warnSoft, fg: colors.warn, sub: colors.warnInk },
  info: { bg: colors.primarySoft, fg: colors.primary, sub: colors.primaryInk },
  error: { bg: colors.dangerSoft, fg: colors.danger, sub: colors.danger },
  ok: { bg: colors.okSoft, fg: colors.ok, sub: colors.ok },
};

export function Banner({ kind = 'warn', icon = 'alert', title, subtitle, actionLabel, onAction, actionLoading }) {
  const k = BANNER_KINDS[kind];
  return (
    <View style={[styles.banner, { backgroundColor: k.bg }]} accessibilityRole="summary">
      <Icon name={icon} size={20} color={k.fg} strokeWidth={2} />
      <View style={{ flex: 1, gap: 2 }}>
        {title ? <Text style={[styles.bannerTitle, { color: k.fg }]}>{title}</Text> : null}
        {subtitle ? <Text style={[styles.bannerSub, { color: k.sub }]}>{subtitle}</Text> : null}
      </View>
      {actionLabel ? (
        <Pressable accessibilityRole="button" onPress={onAction} disabled={actionLoading} style={styles.bannerAction}>
          {actionLoading ? <ActivityIndicator color={k.fg} /> : <Text style={[styles.bannerActionText, { color: k.fg }]}>{actionLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

export function Note({ icon = 'info', children, kind = 'info' }) {
  const k = BANNER_KINDS[kind];
  return (
    <View style={[styles.note, { backgroundColor: k.bg }]}>
      <Icon name={icon} size={18} color={k.fg} strokeWidth={2} />
      <Text style={[styles.noteText, { color: k.sub }]}>{children}</Text>
    </View>
  );
}

export function EmptyState({ icon = 'box', title, body, children }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Icon name={icon} size={24} color={colors.ink3} />
      </View>
      <Text style={[type.bodyStrong, { textAlign: 'center' }]}>{title}</Text>
      {body ? <Text style={[type.small, { textAlign: 'center' }]}>{body}</Text> : null}
      {children}
    </View>
  );
}

export function InlineEmpty({ children }) {
  return <Text style={[type.small, { color: colors.ink3 }]}>{children}</Text>;
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.ink3} />
    </View>
  );
}

export function BarRow({ name, you = false, value, max, label, danger = false }) {
  const pct = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.barLabelRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
          <Text style={styles.barName} numberOfLines={1}>
            {name}
          </Text>
          {you && (
            <View style={styles.youTag}>
              <Text style={styles.youTagText}>You</Text>
            </View>
          )}
        </View>
        <Text style={[styles.barValue, danger && { color: colors.danger }]}>{label}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${pct * 100}%`, backgroundColor: you ? colors.ink : colors.primary }]} />
      </View>
    </View>
  );
}

// Company-scoped sub-navigation shown when a Main Company user drills into a Sub Company.
export function CompanySwitcher({ active, params }) {
  const navigation = useNavigation();
  const sections = [
    { key: 'inventory', label: 'Inventory', route: 'CompanyInventory' },
    { key: 'reports', label: 'Reports', route: 'CompanyReports' },
    { key: 'audit', label: 'Audit log', route: 'CompanyAuditLog' },
  ];
  return (
    <Segmented
      accessibilityLabel="Company sections"
      options={sections}
      value={active}
      onChange={(key) => {
        if (key === active) return;
        navigation.replace(sections.find((s) => s.key === key).route, params);
      }}
    />
  );
}

export function ReadOnlyBanner({ subtitle }) {
  return <Banner kind="warn" icon="eye" title="Read-only view" subtitle={subtitle} />;
}

export function Sheet({ visible, onClose, title, description, children, footer }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 14 }]} accessibilityViewIsModal>
          <View style={styles.sheetHandle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 16 }} bounces={false}>
            <View style={{ gap: 6 }}>
              <Text style={type.sheetTitle} accessibilityRole="header">
                {title}
              </Text>
              {description ? <Text style={type.small}>{description}</Text> : null}
            </View>
            {children}
            {footer ? <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>{footer}</View> : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: fonts.regular, color: colors.ink },
  screen: { flex: 1, backgroundColor: colors.ground },
  largeHeader: { paddingHorizontal: 20, paddingBottom: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  eyebrow: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  headerActions: { flexDirection: 'row', gap: 8 },
  navHeader: { paddingHorizontal: 8, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' },
  navSide: { width: 52, height: 44, justifyContent: 'center' },
  navBack: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 17 },
  iconButton: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  dot: {
    position: 'absolute', top: 9, right: 10, width: 10, height: 10, borderRadius: 5,
    backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.surface,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontFamily: fonts.semibold, fontSize: 14, letterSpacing: 0.3 },
  button: {
    borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  buttonText: { fontFamily: fonts.semibold, fontSize: 16 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  optional: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink3 },
  inputBox: {
    minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md,
    backgroundColor: colors.surface, paddingLeft: 14, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  inputBoxFocused: {
    borderColor: colors.primary, shadowColor: colors.primary, shadowOpacity: 0.18, shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 }, elevation: 0,
  },
  prefix: { fontSize: 16, color: colors.ink3, marginRight: -4 },
  input: { flex: 1, minHeight: 48, fontFamily: fonts.regular, fontSize: 16, color: colors.ink, paddingVertical: 0 },
  fieldError: { fontSize: 12, color: colors.danger, fontFamily: fonts.medium },
  search: {
    flex: 1, height: 48, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1,
    borderColor: colors.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10,
  },
  chip: {
    height: 38, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  chipActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  chipCount: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink3 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 10, borderRadius: 13, alignSelf: 'flex-start' },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontFamily: fonts.semibold, fontSize: 12 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  countBadgeText: { fontFamily: fonts.semibold, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.xl },
  divider: { height: 1, backgroundColor: colors.line },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 28, gap: 8 },
  sectionAction: { paddingVertical: 8, paddingLeft: 8 },
  link: { fontFamily: fonts.semibold, fontSize: 14, color: colors.primary },
  segmented: { flexDirection: 'row', padding: 4, borderRadius: radius.lg, backgroundColor: colors.segment, gap: 2 },
  segment: { flex: 1, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  segmentActive: {
    backgroundColor: colors.surface, shadowColor: '#15171C', shadowOpacity: 0.1, shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  segmentText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  tile: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileText: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 },
  kvLabel: { fontSize: 14, color: colors.ink2 },
  kvValue: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  statValue: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBig: {
    height: 66, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 16, backgroundColor: colors.surface,
    paddingHorizontal: 6, justifyContent: 'space-between',
  },
  stepperInput: {
    minWidth: 88, flexGrow: 1, height: 52, textAlign: 'center', fontFamily: fonts.display, fontSize: 22,
    color: colors.ink, borderRadius: 12, paddingVertical: 0,
  },
  bottomBar: { paddingHorizontal: 20, paddingTop: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, gap: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingLeft: 14, paddingRight: 8, borderRadius: 16, minHeight: 56 },
  bannerTitle: { fontFamily: fonts.semibold, fontSize: 14 },
  bannerSub: { fontSize: 12, lineHeight: 16 },
  bannerAction: { height: 44, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  bannerActionText: { fontFamily: fonts.semibold, fontSize: 14 },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 24 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.muted, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ground },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
  barName: { fontFamily: fonts.medium, fontSize: 14, flexShrink: 1 },
  barValue: { fontFamily: fonts.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: colors.track, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  youTag: { backgroundColor: colors.primarySoft, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  youTagText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.primary },
  sheetOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,19,34,0.5)' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 10, maxHeight: '92%', ...shadow.raised,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: 3, backgroundColor: colors.lineStrong, marginBottom: 12 },
});
