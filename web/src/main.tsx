import { render } from "preact";
// Self-hosted (bundled into assets/), so no third-party font requests and no CSP change. The
// phone uses Figtree and Literata, the Mac IBM Plex (#12); browsers fetch only the faces in use.
import "@fontsource-variable/figtree";
import "@fontsource-variable/literata";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-serif/400.css";
import "@fontsource/ibm-plex-serif/500.css";
import "@fontsource/ibm-plex-serif/600.css";
import { App } from "./app.js";
import "./styles.css";

render(<App />, document.getElementById("app")!);
