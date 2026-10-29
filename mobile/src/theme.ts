/**
 * RupeeSplit design tokens.
 *
 * Two finished palettes — deep midnight and warm porcelain — are chosen from
 * the device appearance at launch. Both keep the same semantic hues: mint for
 * money that is yours, coral for money you owe, violet for voice and AI,
 * amber for caution. The rest of the app only ever reads tokens from here.
 */
import { Appearance } from 'react-native'

const dark = {
  bg: '#080a17',
  bgElevated: '#0c1020',
  surface: '#111528',
  surfaceAlt: '#171c33',
  surfaceHigh: '#1f2540',
  border: '#2b3252',
  borderSoft: '#20263f',

  text: '#f4f6ff',
  textSoft: '#d3d8f0',
  muted: '#9aa3c7',
  mutedDim: '#6d769b',

  accent: '#4fe3ac',
  accentDeep: '#1fb885',
  accentInk: '#04170f',
  lime: '#c4f36a',
  coral: '#ff8a72',
  danger: '#ff6f61',
  warn: '#f4c96b',
  info: '#7bb8ff',
  violet: '#b79bff',
  magenta: '#ff9ec7',
  positive: '#4fe3ac',
  negative: '#ff8a72',

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(4, 6, 16, 0.74)',
  glass: 'rgba(24, 30, 54, 0.7)',
  onBackground: '#f4f6ff',
  brand: '#080a17',
  brandSub: '#9aa3c7',

  mintWash: 'rgba(79, 227, 172, 0.12)',
  violetWash: 'rgba(183, 155, 255, 0.14)',
  coralWash: 'rgba(255, 138, 114, 0.14)',
} as const

const light = {
  bg: '#f7f3ec',
  bgElevated: '#fffdf8',
  surface: '#fffdf9',
  surfaceAlt: '#f4eee3',
  surfaceHigh: '#ebe2d3',
  border: '#ded2bf',
  borderSoft: '#e9dfcf',

  text: '#1b2230',
  textSoft: '#414a5e',
  muted: '#6a7285',
  mutedDim: '#949bab',
  accent: '#0e9a72',
  accentDeep: '#0a7a5a',
  accentInk: '#ffffff',
  lime: '#6d9a1f',
  coral: '#cf5238',
  danger: '#c4362a',
  warn: '#b47a12',
  info: '#2f6fb5',
  violet: '#7455cf',
  magenta: '#b3407c',
  positive: '#0e9a72',
  negative: '#cf5238',

  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(24, 30, 44, 0.42)',
  glass: 'rgba(255, 255, 255, 0.74)',
  onBackground: '#1b2230',
  brand: '#f7f3ec',
  brandSub: '#6a7285',

  mintWash: 'rgba(14, 154, 114, 0.12)',
  violetWash: 'rgba(116, 85, 207, 0.12)',
  coralWash: 'rgba(207, 82, 56, 0.12)',
}

export const isDark = Appearance.getColorScheme() !== 'light'

export const colors = (isDark ? dark : light) as typeof dark

/** Category colours used by the ledger and the trip map pins. */
export const categoryColors: Record<string, string> = isDark
  ? {
      food: '#ffb86b',
      travel: '#7bb8ff',
      stay: '#b79bff',
      groceries: '#9ee87a',
      entertainment: '#ff9ec7',
      utilities: '#f4c96b',
      shopping: '#7fe7d1',
      other: '#9aa3c7',
    }
  : {
      food: '#c47414',
      travel: '#2f6fb5',
      stay: '#7455cf',
      groceries: '#4f7a1f',
      entertainment: '#b3407c',
      utilities: '#a87614',
      shopping: '#0f7f78',
      other: '#6a7285',
    }

export const categoryEmoji: Record<string, string> = {
  food: '🍽️',
  travel: '🚕',
  stay: '🛏️',
  groceries: '🛒',
  entertainment: '🎟️',
  utilities: '💡',
  shopping: '🛍️',
  other: '📦',
}

export const gradients = isDark
  ? {
      /** App background wash: midnight indigo into a deep forest corner. */
      canvas: ['#080a17', '#0a1218', '#071310'] as const,
      /** Primary action: mint into lime, reserved for the one thing to do. */
      primary: ['#54ecb4', '#8ff07a'] as const,
      primaryPressed: ['#3fd49f', '#7bd968'] as const,
      /** Hero balance card: indigo with a violet edge. */
      hero: ['#1d2246', '#111a2c'] as const,
      heroOwed: ['#123a2d', '#0c2620'] as const,
      heroDebt: ['#40212c', '#241320'] as const,
      mint: ['#4fe3ac', '#1fb885'] as const,
      coral: ['#ff9c86', '#ff6f61'] as const,
      gold: ['#f7d78b', '#e3ae45'] as const,
      violet: ['#c8b4ff', '#8f7bff'] as const,
      voice: ['#8f7bff', '#4fe3ac'] as const,
      aurora: ['#8f7bff', '#4fe3ac', '#ffb86b'] as const,
      sheen: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.00)'] as const,
    }
  : {
      canvas: ['#f9f5ee', '#eef4ef', '#f8f1e9'] as const,
      primary: ['#16b489', '#7cc63f'] as const,
      primaryPressed: ['#12a379', '#6db534'] as const,
      hero: ['#eef1fd', '#e3ecf7'] as const,
      heroOwed: ['#e4f5ec', '#d8f0e2'] as const,
      heroDebt: ['#fbe9e4', '#f7dcd4'] as const,
      mint: ['#16b489', '#0a7a5a'] as const,
      coral: ['#e0775f', '#cf5238'] as const,
      gold: ['#e0a93c', '#b47a12'] as const,
      violet: ['#9b83ea', '#7455cf'] as const,
      voice: ['#7455cf', '#0e9a72'] as const,
      aurora: ['#9b83ea', '#16b489', '#e0a93c'] as const,
      sheen: ['rgba(255,255,255,0.65)', 'rgba(255,255,255,0.00)'] as const,
    }

/** Soft fills for pills, banners and highlighted rows. */
export const tints = isDark
  ? {
      mint: { fill: '#0f2e24', border: '#2b5b49' },
      accent: { fill: '#123f30', border: '#2b6b52' },
      warn: { fill: '#3c2f12', border: '#5a4718' },
      bad: { fill: '#3d211b', border: '#5a2b22' },
      info: { fill: '#122e3d', border: '#1d4a63' },
      neutral: { fill: '#1c2238', border: '#2b3252' },
      ok: { fill: '#12301f', border: '#1f5a3c' },
    }
  : {
      mint: { fill: '#e8f6ee', border: '#bfe6d2' },
      accent: { fill: '#ddf4e8', border: '#b4e2cc' },
      warn: { fill: '#fbf0d7', border: '#ecd39b' },
      bad: { fill: '#fbe5df', border: '#eec0b5' },
      info: { fill: '#e3eefa', border: '#bcd6f0' },
      neutral: { fill: '#f0ebe1', border: '#ddd2be' },
      ok: { fill: '#e0f5e8', border: '#b7e3c9' },
    }

/** Avatar palette with enough hue spread for both schemes. */
export const avatarPalette = isDark
  ? ['#2f8f70', '#c8553d', '#3d7fb8', '#b8892a', '#7a4fa0', '#2d8a9a', '#a54e75', '#5c7b3a']
  : ['#0e9a72', '#c4543b', '#2f6fb5', '#a87614', '#7455cf', '#0f7f78', '#b3407c', '#4f7a1f']

export const spacing = (n: number) => n * 4

export const radius = {
  xs: 6,
  sm: 10,
  md: 14,
  lg: 20,
  xl: 26,
  xxl: 34,
  pill: 999,
}

export const elevation = {
  card: {
    shadowColor: isDark ? '#000000' : '#6b5b45',
    shadowOpacity: isDark ? 0.34 : 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheet: {
    shadowColor: isDark ? '#000000' : '#5c4c38',
    shadowOpacity: isDark ? 0.5 : 0.18,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -14 },
    elevation: 24,
  },
  fab: {
    shadowColor: isDark ? '#2fe0a4' : '#0e9a72',
    shadowOpacity: 0.45,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
} as const

export const type = {
  display: { fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontSize: 24, fontWeight: '800' as const, letterSpacing: -0.5 },
  heading: { fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  body: { fontSize: 15, fontWeight: '500' as const },
  bodyStrong: { fontSize: 15, fontWeight: '700' as const },
  small: { fontSize: 13, fontWeight: '500' as const },
  caption: { fontSize: 11.5, fontWeight: '600' as const, letterSpacing: 0.5 },
  amount: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -1 },
}

/** Motion helpers keep durations consistent across the app. */
export const motion = {
  fast: 140,
  base: 240,
  slow: 380,
  spring: { damping: 18, stiffness: 190, mass: 0.9 },
  springSoft: { damping: 22, stiffness: 140, mass: 1 },
} as const

/** Static style objects shared by primitives. */
export const hairline = 1
