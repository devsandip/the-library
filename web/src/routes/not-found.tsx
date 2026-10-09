import { BASE } from "../config.js";

export function NotFound() {
  return (
    <section>
      <h1>Nothing here.</h1>
      <p>
        <a href={`${BASE}/`}>Back to the Library</a>
      </p>
    </section>
  );
}
