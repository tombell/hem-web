/** @jsxImportSource preact */
import { useState } from "preact/hooks";

import { Connect } from "./components/connect";
import { Dashboard } from "./components/dashboard";
import type { Source } from "./data";

export function App() {
  const [token, setToken] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [notice, setNotice] = useState("");
  return token ? (
    <Dashboard
      token={token}
      sources={sources}
      disconnect={(message = "") => {
        setToken("");
        setSources([]);
        setNotice(message);
      }}
    />
  ) : (
    <Connect
      notice={notice}
      onConnect={(value, rows) => {
        setSources(rows);
        setToken(value);
        setNotice("");
      }}
    />
  );
}
