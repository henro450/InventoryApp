// Single source of truth for the app's look. Red is reserved for low stock / destructive
// actions, amber for sync issues a person needs to look at, green for money and synced state.
export const colors = {
  ink: '#15171C',
  ink2: '#4A4F5A',
  ink3: '#5E6371',
  label: '#2A2E37',
  chevron: '#9A9EA8',
  placeholder: '#6E7381',
  ground: '#F4F3EF',
  surface: '#FFFFFF',
  surfaceMuted: '#F7F6F2',
  muted: '#ECEAE4',
  segment: '#E9E7E0',
  track: '#EEECE6',
  line: '#E4E2DB',
  lineStrong: '#D6D3CA',
  lineSoft: '#F0EEE8',
  primary: '#1F3FD1',
  primarySoft: '#E9EDFD',
  primaryInk: '#1A2E8F',
  danger: '#B42318',
  dangerSoft: '#FCEBE9',
  dangerLine: '#F3CFCA',
  warn: '#8A5300',
  warnInk: '#6E4300',
  warnSoft: '#FDF1DC',
  warnLine: '#E9C98F',
  ok: '#17784A',
  okSoft: '#E3F2EA',
  okOnDark: '#8FE0B5',
  night: '#0E1322',
  camera: '#10141E',
  onDarkMuted: '#B9BFD0',
};

export const fonts = {
  regular: 'IBMPlexSans_400Regular',
  medium: 'IBMPlexSans_500Medium',
  semibold: 'IBMPlexSans_600SemiBold',
  display: 'BricolageGrotesque_700Bold',
  displaySemi: 'BricolageGrotesque_600SemiBold',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
};

// Passed to expo-font's useFonts in App.js; keys must match the family names above. Files are
// required directly so only these seven weights ship, not every weight in each package.
export const fontAssets = {
  IBMPlexSans_400Regular: require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'),
  IBMPlexSans_500Medium: require('@expo-google-fonts/ibm-plex-sans/500Medium/IBMPlexSans_500Medium.ttf'),
  IBMPlexSans_600SemiBold: require('@expo-google-fonts/ibm-plex-sans/600SemiBold/IBMPlexSans_600SemiBold.ttf'),
  BricolageGrotesque_600SemiBold: require('@expo-google-fonts/bricolage-grotesque/600SemiBold/BricolageGrotesque_600SemiBold.ttf'),
  BricolageGrotesque_700Bold: require('@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf'),
  IBMPlexMono_400Regular: require('@expo-google-fonts/ibm-plex-mono/400Regular/IBMPlexMono_400Regular.ttf'),
  IBMPlexMono_500Medium: require('@expo-google-fonts/ibm-plex-mono/500Medium/IBMPlexMono_500Medium.ttf'),
};

export const radius = { sm: 10, md: 12, lg: 14, xl: 18, xxl: 22 };

export const type = {
  display: { fontFamily: fonts.display, fontSize: 40, lineHeight: 44, letterSpacing: -1.2, color: colors.ink },
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 36, letterSpacing: -0.6, color: colors.ink },
  sheetTitle: { fontFamily: fonts.display, fontSize: 26, lineHeight: 30, letterSpacing: -0.5, color: colors.ink },
  heading: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, color: colors.ink },
  bodyStrong: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.ink2 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, color: colors.label },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.ink3 },
  mono: { fontFamily: fonts.mono, fontSize: 12, lineHeight: 16, color: colors.ink3 },
};

export const shadow = {
  raised: {
    shadowColor: '#15171C',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primary: {
    shadowColor: '#1F3FD1',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};
