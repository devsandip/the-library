/**
 * Inline SVG icons (no icon font, no emoji): 24 px, stroke 1.8, round joins (the redesign).
 * Everything else is a typeset mark in the label's own font: ↩ ↗ ‹ › ★ ✓ ✕.
 */
const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  "aria-hidden": "true",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
} as const;

export function TodayIcon() {
  return (
    <svg {...base}>
      <rect x="4.5" y="7.5" width="15" height="13" rx="2.5" />
      <path d="M7 4.5h10" />
    </svg>
  );
}

export function BrowseIcon() {
  return (
    <svg {...base}>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </svg>
  );
}

export function SavedIcon() {
  return (
    <svg {...base}>
      <path d="M7 4h10v16l-5-3.6L7 20z" />
    </svg>
  );
}

/** The corner brackets of the Machine's box around an L. */
export function LibraryIcon() {
  return (
    <svg {...base}>
      <path d="M4 8.5V4h4.5M15.5 4H20v4.5M20 15.5V20h-4.5M8.5 20H4v-4.5" />
      <path d="M10 8v8h5" />
    </svg>
  );
}

export function SearchIcon({ size = 20 }: { size?: number }) {
  return (
    <svg {...base} width={size} height={size} stroke-width={2}>
      <circle cx="11" cy="11" r="6" />
      <path d="M20 20l-4.5-4.5" />
    </svg>
  );
}

/** Thumbs up (it was useful), or with `down`, thumbs down. */
export function ThumbIcon({ down = false, size = 20 }: { down?: boolean; size?: number }) {
  return (
    <svg {...base} width={size} height={size} class="thumb-icon">
      <g transform={down ? "rotate(180 12 12)" : undefined}>
        <path d="M7 10v11" />
        <path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 8a2 2 0 0 1-1.9 1.4H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.8a2 2 0 0 0 1.8-1.1L12 2a3.1 3.1 0 0 1 3 3.9Z" />
      </g>
    </svg>
  );
}
