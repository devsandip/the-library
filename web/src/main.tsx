import { render } from "preact";
// Self-hosted (bundled into assets/), so no third-party font requests and no CSP change.
import "@fontsource-variable/public-sans";
import "@fontsource-variable/source-serif-4";
import { App } from "./app.js";
import "./styles.css";

render(<App />, document.getElementById("app")!);
