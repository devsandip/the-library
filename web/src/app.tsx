import { useEffect, useState } from "preact/hooks";
import { LocationProvider, useLocation } from "preact-iso";
import { HttpLibraryApi } from "./api.js";
import { Auth } from "./auth.js";
import { BASE, loadConfig } from "./config.js";
import { Ctx, type AppContext } from "./context.js";
import { LibraryProvider } from "./library.js";
import { useMedia, WIDE } from "./media.js";
import {
  browseHref,
  DEFAULT_BROWSE,
  libraryHref,
  parse,
  redirect,
  savedHref,
  todayHref,
  type Screen,
} from "./paths.js";
import { Console } from "./mac/console.js";
import { History } from "./pages/history.js";
import { Newsletter, Newsletters } from "./pages/newsletters.js";
import { Search } from "./pages/search.js";
import { Settings } from "./pages/settings.js";
import { Status } from "./pages/status.js";
import { Browse } from "./phone/browse.js";
import { LibraryHome } from "./phone/library-home.js";
import { Reader } from "./phone/reader.js";
import { Saved } from "./phone/saved.js";
import { Today } from "./phone/today.js";
import { BrowseIcon, LibraryIcon, SavedIcon, TodayIcon } from "./components/icons.js";
import { ToastProvider, ToastView } from "./components/toast.js";

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

/** Library's pages are the same on both devices. */
function libraryPage(screen: Screen, wide: boolean) {
  switch (screen.name) {
    case "search":
      return <Search q={screen.q} sort={screen.sort} wide={wide} />;
    case "history":
      return <History day={screen.day} wide={wide} />;
    case "newsletters":
      return <Newsletters wide={wide} />;
    case "newsletter":
      return <Newsletter slug={screen.slug} wide={wide} />;
    case "status":
      return <Status wide={wide} />;
    case "settings":
      return <Settings wide={wide} />;
  }
  return undefined;
}

function NotFound() {
  return (
    <section class="lib-page">
      <h1 class="page-title">Nothing here.</h1>
      <p class="empty-text">That link does not lead anywhere in Nutgraf.</p>
      <a class="btn line" href={`${BASE}/`}>
        Back to Nutgraf
      </a>
    </section>
  );
}

type Tab = "today" | "browse" | "saved" | "library";

const TABS: { id: Tab; label: string; href: string; Icon: () => preact.JSX.Element }[] = [
  { id: "today", label: "Today", href: todayHref(), Icon: TodayIcon },
  { id: "browse", label: "Browse", href: browseHref(DEFAULT_BROWSE), Icon: BrowseIcon },
  { id: "saved", label: "Saved", href: savedHref(), Icon: SavedIcon },
  { id: "library", label: "Library", href: libraryHref(), Icon: LibraryIcon },
];

function tabOf(screen: Screen): Tab | undefined {
  switch (screen.name) {
    case "today":
    case "browse":
    case "saved":
    case "library":
      return screen.name;
    case "search":
    case "history":
    case "newsletters":
    case "newsletter":
    case "status":
    case "settings":
      return "library";
  }
  return undefined;
}

/**
 * The phone's bottom bar: four tabs, always there except while reading. A tap on the tab you are
 * on goes to its start (Browse keeps its filters).
 */
function TabBar({ screen }: { screen: Screen }) {
  const on = tabOf(screen);
  return (
    <nav class="tab-bar" aria-label="Main">
      {TABS.map(({ id, label, href, Icon }) => (
        <a
          key={id}
          class={`tab-item${on === id ? " on" : ""}`}
          href={id === "browse" && screen.name === "browse" ? browseHref(screen.filters) : href}
          aria-current={on === id ? "page" : undefined}
        >
          <Icon />
          {label}
        </a>
      ))}
    </nav>
  );
}

function Phone({ screen }: { screen: Screen }) {
  const reading = screen.name === "issue";
  let view;
  switch (screen.name) {
    case "today":
      view = <Today mode={screen.mode} />;
      break;
    case "browse":
      view = <Browse filters={screen.filters} />;
      break;
    case "saved":
      view = <Saved />;
      break;
    case "library":
      view = <LibraryHome />;
      break;
    case "issue":
      view = <Reader key={screen.id} id={screen.id} story={screen.story} deep={screen.deep} />;
      break;
    default:
      view = libraryPage(screen, false) ?? <NotFound />;
  }
  const full = screen.name === "today" && screen.mode === "brief";
  return (
    <div class={`phone${reading || full ? " reading" : ""}`}>
      <main class="phone-main">{view}</main>
      {!reading && !full && <TabBar screen={screen} />}
      <ToastView />
    </div>
  );
}

/**
 * Phone up to 760 px (four tabs), the Mac's console above. Old URLs and the other device's URLs
 * are sent to their place first, so a bookmark or a link opened on the wrong device still lands.
 */
function Shell() {
  const wide = useMedia(WIDE);
  const { path, query, route } = useLocation();
  const to = redirect(path, query, wide);
  useEffect(() => {
    if (to) route(to, true);
  }, [to]);
  if (to) return null;
  const screen = parse(path, query);
  return (
    <ToastProvider wide={wide}>
      {wide ? (
        <Console
          screen={screen}
          page={
            libraryPage(screen, true) ?? (screen.name === "not-found" ? <NotFound /> : undefined)
          }
        />
      ) : (
        <Phone screen={screen} />
      )}
    </ToastProvider>
  );
}

export function App() {
  const [state, setState] = useState<Boot>({ kind: "loading" });

  useEffect(() => {
    boot().then(
      (ctx) => setState({ kind: "ready", ctx }),
      (err: Error) => setState({ kind: "error", message: err.message }),
    );
  }, []);

  if (state.kind === "loading") return <p class="boot">Opening Nutgraf…</p>;
  if (state.kind === "error") {
    return (
      <main class="boot">
        <p>Nutgraf could not start: {state.message}</p>
        <button type="button" class="btn fill" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    );
  }

  return (
    <Ctx.Provider value={state.ctx}>
      <LocationProvider scope={BASE}>
        <LibraryProvider>
          <Shell />
        </LibraryProvider>
      </LocationProvider>
    </Ctx.Provider>
  );
}
