import { BASE } from "../config.js";

/** R6 placeholder; the reading list arrives in R7. */
export function Home() {
  return (
    <section>
      <h1>No new numbers.</h1>
      <p class="muted">
        The reading list arrives with the next build step. Sign-in works; see{" "}
        <a href={`${BASE}/status`}>Status</a>.
      </p>
    </section>
  );
}
