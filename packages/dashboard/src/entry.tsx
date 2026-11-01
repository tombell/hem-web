import { render } from "preact";

import { App } from "./main";

render(<App />, document.getElementById("app")!);

// eslint-disable-next-line import/no-unassigned-import
import "./styles.css";
