import { activeScheme } from './scheme';

export const isDark = activeScheme === 'dark';

// Single source of truth for the app's look. Red is reserved for low stock / destructive
// actions, amber for sync issues a person needs to look at, green for money and synced state.
// Two palettes with the same keys; `colors` is the one this run of the app uses (see scheme.js).
// `ink` is text; `inkBg` is the dark fill behind white text (hero cards, dark buttons, active
// chips), which stays dark in dark mode. `*Fill` colours sit behind white text.
const light = {
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
  dashed: '#CFCBC1',
  primary: '#1F3FD1',
  primarySoft: '#E9EDFD',
  primaryInk: '#1A2E8F',
  danger: '#B42318',
  dangerFill: '#B42318',
  dangerSoft: '#FCEBE9',
  dangerLine: '#F3CFCA',
  dangerBorder: '#EBC5C0',
  warn: '#8A5300',
  warnInk: '#6E4300',
  warnSoft: '#FDF1DC',
  warnLine: '#E9C98F',
  ok: '#17784A',
  okFill: '#17784A',
  okSoft: '#E3F2EA',
  okLine: '#BFE0CC',
  okInk: '#0F5434',
  okSub: '#2F6B4C',
  okOnDark: '#8FE0B5',
  inkBg: '#15171C',
  onInk: '#FFFFFF',
  onInkFaint: '#C3C7D2',
  tileMuted: '#F1F0EC',
  tileMutedInk: '#8C909A',
  night: '#0E1322',
  camera: '#10141E',
  onDarkMuted: '#B9BFD0',
  heroFaint: '#8D93A5',
};

const dark = {
  ink: '#ECEDF1',
  ink2: '#B9BDC8',
  ink3: '#9CA1AE',
  label: '#D7DAE1',
  chevron: '#6D7280',
  placeholder: '#7F8492',
  ground: '#0F1115',
  surface: '#181B21',
  surfaceMuted: '#1F232A',
  muted: '#272B33',
  segment: '#23272F',
  track: '#262A32',
  line: '#2A2E36',
  lineStrong: '#3A3F49',
  lineSoft: '#21252C',
  dashed: '#3D424C',
  primary: '#6F88FF',
  primarySoft: '#1C2447',
  primaryInk: '#AFBEFF',
  danger: '#FF8A80',
  dangerFill: '#C93A2F',
  dangerSoft: '#381B19',
  dangerLine: '#5A2925',
  dangerBorder: '#5A2925',
  warn: '#F0B25A',
  warnInk: '#F5C987',
  warnSoft: '#33270F',
  warnLine: '#5E4517',
  ok: '#5FD69A',
  okFill: '#1E8A56',
  okSoft: '#132C1E',
  okLine: '#245A3B',
  okInk: '#8FE0B5',
  okSub: '#7CC59F',
  okOnDark: '#8FE0B5',
  inkBg: '#262A35',
  onInk: '#FFFFFF',
  onInkFaint: '#C3C7D2',
  tileMuted: '#22262D',
  tileMutedInk: '#80859A',
  night: '#0B0E17',
  camera: '#10141E',
  onDarkMuted: '#B9BFD0',
  heroFaint: '#8D93A5',
};

export const colors = isDark ? dark : light;

// Money out, by kind: `ink` on light surfaces, `onDark` for the Overview's dark card, `soft` for
// icon tiles. Calm hues on purpose; money going out is normal, so none of them is red.
const outflowLight = {
  stock: { ink: '#6B7489', onDark: '#B9BFD0', soft: '#ECEEF2' },
  expense: { ink: '#A8571A', onDark: '#F2B880', soft: '#F6E8DC' },
  savings: { ink: '#17784A', onDark: '#8FE0B5', soft: '#E3F2EA' },
  savings_return: { ink: '#5E6371', onDark: '#B9BFD0', soft: '#ECEAE4' },
  withdrawal: { ink: '#6D4BC2', onDark: '#C9B6F2', soft: '#EEE8FA' },
  loan: { ink: '#2950C9', onDark: '#93ACF5', soft: '#E7EDFC' },
  refund: { ink: '#7A6A12', onDark: '#E6D88A', soft: '#F4F0D8' },
  tax: { ink: '#366B87', onDark: '#8FC3DC', soft: '#E3EFF5' },
};

// In dark mode the light hues become the text colour and the tiles turn into dim tints.
const outflowDark = {
  stock: { ink: '#B9BFD0', onDark: '#B9BFD0', soft: '#262A33' },
  expense: { ink: '#F2B880', onDark: '#F2B880', soft: '#36271B' },
  savings: { ink: '#8FE0B5', onDark: '#8FE0B5', soft: '#152E21' },
  savings_return: { ink: '#B9BFD0', onDark: '#B9BFD0', soft: '#272B33' },
  withdrawal: { ink: '#C9B6F2', onDark: '#C9B6F2', soft: '#2A2340' },
  loan: { ink: '#93ACF5', onDark: '#93ACF5', soft: '#1D2645' },
  refund: { ink: '#E6D88A', onDark: '#E6D88A', soft: '#302C17' },
  tax: { ink: '#8FC3DC', onDark: '#8FC3DC', soft: '#182C36' },
};

export const outflowColors = isDark ? outflowDark : outflowLight;

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
    shadowColor: '#000000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  primary: {
    shadowColor: colors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
};
