import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { BASE } from "../config.js";
import { SummaryIcon } from "./icons.js";

/** Where Home puts its News | Learning control: in the header row on the Mac, under it on phones. */
export const HeaderSlot = createContext<{
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
}>({ slot: null, setSlot: () => undefined });

export const useHeaderSlot = () => useContext(HeaderSlot).slot;

export function Header() {
  const { setSlot } = useContext(HeaderSlot);
  return (
    <header class="site-header">
      <div class="header-inner">
        <a class="wordmark" href={`${BASE}/`}>
          The Library
        </a>
        <div class="header-slot" ref={setSlot} />
        <nav class="header-nav" aria-label="Main">
          <a class="pill" href={`${BASE}/summary`}>
            <SummaryIcon />
            Summary
          </a>
          <a class="nav-link" href={`${BASE}/status`}>
            Status
          </a>
        </nav>
      </div>
    </header>
  );
}
