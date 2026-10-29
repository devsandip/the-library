/**
 * Features built but kept out of the live app. Highlights (#71) were shaped around one reader's
 * Obsidian vault; they stay hidden until they fit anyone who reads in Nutgraf. `VITE_HIGHLIGHTS=1`
 * turns them on in a local build (`VITE_MOCK=1 VITE_HIGHLIGHTS=1 pnpm --filter @library/web dev`).
 */
export const HIGHLIGHTS = import.meta.env.VITE_HIGHLIGHTS === "1";
