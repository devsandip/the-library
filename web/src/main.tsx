import { render } from "preact";
import { App } from "./app.js";
import { trackNavigation } from "./nav.js";
import { applyTheme, readTheme } from "./theme.js";
import "./styles.css";

applyTheme(readTheme());
trackNavigation();
render(<App />, document.getElementById("app")!);
