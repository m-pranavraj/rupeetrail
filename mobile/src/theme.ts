/**
 * RupeeSplit design tokens.
 *
 * One place for colour, elevation and motion so every screen feels like the
 * same app. Values are deliberately deep and low-contrast on backgrounds, with
 * a single vivid mint accent for money that is *yours* and coral for money you
 * owe — the two states that matter most in a shared ledger.
 */export const colors = {
  bg: '#07130f',
  bgElevated: '#0b1b15',
  surface: '#10241c',
  surfaceAlt: '#163026',
  surfaceHigh: '#1c3b2f',
  border: '#22453a',
  borderSoft: '#18352c',

  text: '#f1fbf6',
  textSoft: '#cfe6db',
  muted: '#8fb3a4',
  mutedDim: '#648578',

  accent: '#4fe3ac',
  accentDeep: '#1fb885',
  accentInk: '#052117',
  lime: '#c4f36a',
  coral: '#ff8a72',
  danger: '#ff6f61',
  warn: '#f4c96b',
  info: '#75b9ff',
  violet: '#b79bff',
  positive: '#4fe3ac',
  negative: '#ff8a72',
  white: '#ffffff',
  black: '#000000',
  overlay: 'rgba(3, 12, 9, 0.72)',
  glass: 'rgba(20, 48, 38, 0.72)',
  onBackground: '#f1fbf6',
  brand: '#07130f',
  brandSub: '#8fb3a4',
} as const


/** Category colours used by the ledger and the trip map pins. */
export const categoryColors: Record<string, string> = {
  food: '#ffb86b',
  travel: '#75b9ff',
  stay: '#b79bff',
  groceries: '#9ee87a',
  entertainment: '#ff9ec7',
  utilities: '#f4c96b',
  shopping: '#7fe7d1',
  other: '#8fb3a4',
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

export const gradients = {
  /** App background wash: near-black green to a softer teal corner. */
  canvas: ['#07130f', '#0a1c15', '#07130f'] as const,
  /** Primary action: mint to lime, used sparingly for the one thing to do. */
  primary: ['#54ecb4', '#8ff07a'] as const,
  primaryPressed: ['#3fd49f', '#7bd968'] as const,
  /** Hero balance card: ink green with a mint edge. */
  hero: ['#12352a', '#0d241c'] as const,
  heroOwed: ['#17392c', '#0e271f'] as const,
  heroDebt: ['#3a211c', '#22130f'] as const,
  /** Small accents. */
  mint: ['#4fe3ac', '#1fb885'] as const,
  coral: ['#ff9c86', '#ff6f61'] as const,
  gold: ['#f7d78b', '#e3ae45'] as const,
  violet: ['#c8b4ff', '#9a7bf0'] as const,
  /** Sheet handles and subtle separators. */
  sheen: ['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.00)'] as const,
}

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
    shadowColor: '#000000',
    shadowOpacity: 0.34,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: -14 },
    elevation: 24,
  },
  fab: {
    shadowColor: '#2fe0a4',
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
