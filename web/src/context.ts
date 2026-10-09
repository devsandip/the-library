import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { LibraryApi } from "./api.js";
import type { Auth } from "./auth.js";
import type { AppConfig } from "./config.js";

export interface AppContext {
  cfg: AppConfig;
  api: LibraryApi;
  /** Absent in mock mode. */
  auth?: Auth;
}

export const Ctx = createContext<AppContext | null>(null);

export function useApp(): AppContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside the app");
  return ctx;
}
