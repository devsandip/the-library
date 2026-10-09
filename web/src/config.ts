/** Runtime config written by CDK to /thelibrary/config.json at deploy time. */
export interface AppConfig {
  stage: string;
  apiBase: string;
  cognitoDomain: string;
  clientId: string;
  /** Local development only: use the in-memory mock API, no sign-in. */
  mock?: boolean;
}

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, ""); // "/thelibrary"

export async function loadConfig(): Promise<AppConfig> {
  if (import.meta.env.VITE_MOCK === "1") {
    return { stage: "mock", apiBase: `${BASE}/api`, cognitoDomain: "", clientId: "", mock: true };
  }
  const res = await fetch(`${BASE}/config.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`config.json: ${res.status}`);
  return (await res.json()) as AppConfig;
}
