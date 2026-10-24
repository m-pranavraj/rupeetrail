interface IconProps {
  size?: number
  className?: string
  strokeWidth?: number
}

function base(props: IconProps) {
  return {
    width: props.size ?? 20,
    height: props.size ?? 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: props.strokeWidth ?? 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: props.className,
    'aria-hidden': true,
  }
}

export const IconPlus = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const IconBack = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
)

export const IconClose = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const IconChevron = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M9 5l7 7-7 7" />
  </svg>
)

export const IconUsers = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M2.8 19.2c.5-3 2.9-4.6 6.2-4.6s5.7 1.6 6.2 4.6" />
    <path d="M16.2 5.3a3 3 0 010 5.6M18 19.2c-.2-2.1-1-3.6-2.4-4.4" />
  </svg>
)

export const IconReceipt = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z" />
    <path d="M9 8h6M9 12h6" />
  </svg>
)

export const IconScale = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v16M7 20h10" />
    <path d="M4.5 9h15M4.5 9l-2.2 5a2.6 2.6 0 004.4 0zM19.5 9l-2.2 5a2.6 2.6 0 004.4 0z" />
    <circle cx="12" cy="5.5" r="1.5" />
  </svg>
)

export const IconCheck = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4.5 12.5l5 5 10-11" />
  </svg>
)

export const IconAlert = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3.6L21 20H3z" />
    <path d="M12 9.5v5M12 17.4v.1" />
  </svg>
)

export const IconTrash = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
    <path d="M10.5 11v5M13.5 11v5" />
  </svg>
)

export const IconEdit = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 20h4.2L19 9.2a2.1 2.1 0 000-3L17.8 5a2.1 2.1 0 00-3 0L4 15.8z" />
    <path d="M14 6l4 4" />
  </svg>
)

export const IconSpark = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.6L20 10.5l-5 3.4L16 20l-4-3.4L8 20l1-6.1-5-3.4 6.1-1.9z" />
  </svg>
)

export const IconArrowRight = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
)

export const IconClock = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)

export const IconLock = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
    <path d="M8 10.5V8a4 4 0 018 0v2.5" />
  </svg>
)

export const IconDownload = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 4v10M8 10.5l4 4 4-4" />
    <path d="M4.5 19.5h15" />
  </svg>
)

export const IconShare = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 15V4.5M8.5 8L12 4.5 15.5 8" />
    <path d="M5 13.5V19a1.5 1.5 0 001.5 1.5h11A1.5 1.5 0 0019 19v-5.5" />
  </svg>
)

export const IconCopy = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="8.5" y="8.5" width="11" height="12" rx="2" />
    <path d="M15.5 8.5v-3a2 2 0 00-2-2h-7a2 2 0 00-2 2v9a2 2 0 002 2h2" />
  </svg>
)

export const IconRefresh = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 10-2.4 5.7" />
    <path d="M20 5v5h-5" />
  </svg>
)
