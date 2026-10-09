import { BASE } from "../config.js";
import { useApp } from "../context.js";

export function Header() {
  const { auth, cfg } = useApp();
  return (
    <header class="site-header">
      <a class="wordmark" href={`${BASE}/`}>
        The Library
      </a>
      <nav>
        <a href={`${BASE}/senders`}>Senders</a>
        <a href={`${BASE}/status`}>Status</a>
        {auth ? (
          <button type="button" class="link" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        ) : (
          <span class="muted">{cfg.stage}</span>
        )}
      </nav>
    </header>
  );
}
