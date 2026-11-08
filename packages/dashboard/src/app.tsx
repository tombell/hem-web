/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

import { Connect } from "./components/connect";
import { Dashboard } from "./components/dashboard";
import type { Source } from "./data";
import type { Session } from "./queries";

export function App() {
  const [session, setSession] = useState<Session>();
  useEffect(() => () => session?.dispose(), [session]);
  const [sources, setSources] = useState<Source[]>([]);
  const [notice, setNotice] = useState("");
  return session ? (
    <Dashboard
      session={session}
      sources={sources}
      disconnect={(message = "") => {
        session.dispose();
        setSession(undefined);
        setSources([]);
        setNotice(message);
      }}
    />
  ) : (
    <Connect
      notice={notice}
      onConnect={(value, rows) => {
        setSources(rows);
        setSession(value);
        setNotice("");
      }}
    />
  );
}
