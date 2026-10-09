import { useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router } from "preact-iso";
import { HttpLibraryApi } from "./api.js";
import { Auth } from "./auth.js";
import { BASE, loadConfig } from "./config.js";
import { Ctx, type AppContext } from "./context.js";
import { Header } from "./components/header.js";
import { Home } from "./routes/home.js";
import { NotFound } from "./routes/not-found.js";
import { Status } from "./routes/status.js";

type Boot =
  { kind: "loading" } | { kind: "ready"; ctx: AppContext } | { kind: "error"; message: string };

async function boot(): Promise<AppContext> {
  const cfg = await loadConfig();
  // Build-time flag first: production builds drop the mock entirely, and no config.json can
  // switch a production build into mock mode.
  if (import.meta.env.VITE_MOCK === "1" && cfg.mock) {
    const { MockLibraryApi } = await import("./mock.js");
    return { cfg, api: new MockLibraryApi() };
  }
  const auth = new Auth(cfg);
  if (location.pathname === `${BASE}/auth/callback`) {
    const back = await auth.completeSignIn(new URL(location.href));
    history.replaceState(null, "", back);
  } else if (!(await auth.accessToken())) {
    await auth.signIn();
  }
  return { cfg, auth, api: new HttpLibraryApi(cfg, auth) };
}

export function App() {
  const [state, setState] = useState<Boot>({ kind: "loading" });

  useEffect(() => {
    boot().then(
      (ctx) => setState({ kind: "ready", ctx }),
      (err: Error) => setState({ kind: "error", message: err.message }),
    );
  }, []);

  if (state.kind === "loading") return <p class="page-message">Opening the Library...</p>;
  if (state.kind === "error") {
    return (
      <main class="page-message">
        <p>{state.message}</p>
        <p>
          <a href={`${BASE}/`}>Try again</a>
        </p>
      </main>
    );
  }

  return (
    <Ctx.Provider value={state.ctx}>
      <LocationProvider scope={BASE}>
        <Header />
        <main class="page">
          <Router>
            <Route path={`${BASE}/`} component={Home} />
            <Route path={`${BASE}/status`} component={Status} />
            <Route default component={NotFound} />
          </Router>
        </main>
      </LocationProvider>
    </Ctx.Provider>
  );
}
