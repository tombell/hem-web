import { render } from "preact";

import { App } from "./app";

const root = document.querySelector("#app");
if (!root) {
  throw new Error("Missing #app element");
}
render(<App />, root);

import "./styles.css";
