/** Inline SVG icons (no emoji, no icon font). 20px, currentColor. */
interface IconProps {
  filled?: boolean;
}

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  "aria-hidden": "true",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

export function ThumbUp({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? "currentColor" : "none"}>
      <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3Z" />
      <path d="M7 10l4.2-7.1A1.9 1.9 0 0 1 14.7 4l-.9 5h5.4a2 2 0 0 1 2 2.3l-1.3 8A2 2 0 0 1 17.9 21H7" />
    </svg>
  );
}

export function ThumbDown({ filled }: IconProps) {
  return (
    <svg {...base} fill={filled ? "currentColor" : "none"}>
      <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3Z" />
      <path d="M17 14l-4.2 7.1A1.9 1.9 0 0 1 9.3 20l.9-5H4.8a2 2 0 0 1-2-2.3l1.3-8A2 2 0 0 1 6.1 3H17" />
    </svg>
  );
}

export function ArchiveIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  );
}

export function UnreadIcon() {
  return (
    <svg {...base}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function ExternalIcon() {
  return (
    <svg {...base}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg {...base}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
