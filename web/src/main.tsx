import { render } from "preact";
// Self-hosted (bundled into assets/), so no third-party font requests and no CSP change (the
// redesign): Newsreader for what is read, IBM Plex Sans for controls and body, IBM Plex Mono for
// ranks, counts, keys and status, Courier Prime for the logo's L. Browsers fetch only the faces in use.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/400-italic.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/courier-prime/700.css";
import { App } from "./app.js";
import { trackNavigation } from "./nav.js";
import { applyTheme, readTheme } from "./theme.js";
import "./styles.css";

applyTheme(readTheme());
trackNavigation();
render(<App />, document.getElementById("app")!);
