import { JotaiDevtools } from "@afcms/jotai-devframe";
import { Provider, useAtom, useAtomValue } from "jotai/react";
import { atom, createStore } from "jotai/vanilla";
import { Suspense, useState } from "react";

import "./style.css";

const countAtom = atom(0);
countAtom.debugLabel = "countAtom";
const doubledAtom = atom((get) => get(countAtom) * 2);
doubledAtom.debugLabel = "doubledAtom";
const profileAtom = atom({
  name: "Ada",
  role: "Engineer",
  preferences: { theme: "dark", notifications: true },
});
profileAtom.debugLabel = "profileAtom";
const privateAtom = atom("Internal implementation detail");
privateAtom.debugLabel = "privateAtom";
privateAtom.debugPrivate = true;
const asyncAtom = atom(async (get) => {
  const count = get(countAtom);
  await new Promise((resolve) => setTimeout(resolve, 350));
  return { result: count * 10 };
});
asyncAtom.debugLabel = "asyncResultAtom";
const collectionAtom = atom(
  new Map<unknown, unknown>([
    ["active", new Set(["alpha", "beta"])],
    ["callback", () => "hello"],
    ["bigint", 123n],
  ]),
);
collectionAtom.debugLabel = "collectionAtom";
const secondary = createStore();

function Counter({ secondary: isSecondary = false }: { secondary?: boolean }) {
  const [count, setCount] = useAtom(countAtom);
  const doubled = useAtomValue(doubledAtom);
  return (
    <div className="demo-counter">
      <span className="demo-number" data-testid={isSecondary ? "secondary-count" : "count"}>
        {count}
      </span>
      <span className="demo-muted">
        Derived value:{" "}
        <strong data-testid={isSecondary ? "secondary-doubled" : "doubled"}>{doubled}</strong>
      </span>
      <div className="demo-buttons">
        <button
          onClick={() => setCount((n) => n - 1)}
          aria-label={isSecondary ? "Decrement secondary" : "Decrement count"}
        >
          −
        </button>
        <button
          onClick={() => setCount((n) => n + 1)}
          aria-label={isSecondary ? "Increment secondary" : "Increment count"}
        >
          +
        </button>
        <button onClick={() => setCount(0)}>Reset</button>
      </div>
    </div>
  );
}
function Profile() {
  const [profile, setProfile] = useAtom(profileAtom);
  return (
    <label className="demo-label">
      Name
      <input
        aria-label="Profile name"
        value={profile.name}
        onChange={(e) => setProfile((p) => ({ ...p, name: e.target.value }))}
      />
    </label>
  );
}
function InterestingValues() {
  useAtomValue(privateAtom);
  useAtomValue(collectionAtom);
  return null;
}

function AsyncPreview() {
  const value = useAtomValue(asyncAtom);
  return (
    <span className="demo-muted">
      Async result: <strong>{value.result}</strong>
    </span>
  );
}

export function DemoApp({ embedded = false }: { embedded?: boolean }) {
  const [extra, setExtra] = useState(false);
  return (
    <>
      <div className="demo-page">
        <header className="demo-header">
          <span>👻</span>
          <strong>Jotai × Devframe</strong>
          <span className="demo-badge">Playground</span>
        </header>
        <main className="demo-main">
          <div className="demo-eyebrow">YOUR APPLICATION. YOUR STATE.</div>
          <h1>
            Make a change.
            <br />
            <span>See the whole story.</span>
          </h1>
          <p className="demo-intro">
            Inspect live atoms, record their history, and restore a moment in time. The inspector
            runs in its own panel.
          </p>
          <div className="demo-grid">
            <section className="demo-card">
              <div className="demo-card-title">
                Counter <code>countAtom</code>
              </div>
              <Counter />
              <Suspense fallback={<span className="demo-muted">Fetching async result…</span>}>
                <AsyncPreview />
              </Suspense>
            </section>
            <section className="demo-card">
              <div className="demo-card-title">
                Profile <code>profileAtom</code>
              </div>
              <Profile />
              <InterestingValues />
            </section>
          </div>
          <div className="demo-actions">
            <button
              className="demo-primary"
              onClick={() =>
                window.open("/__jotai-devtools/", "jotai-inspector", "popup,width=1050,height=760")
              }
            >
              Open inspector popup ↗
            </button>
            <button onClick={() => setExtra((v) => !v)}>
              {extra ? "Unmount" : "Mount"} second store
            </button>
          </div>
          {extra && (
            <Provider store={secondary}>
              <JotaiDevtools name="Secondary store" />
              <section className="demo-card demo-secondary">
                <div className="demo-card-title">
                  Independent store <code>Secondary</code>
                </div>
                <Counter secondary />
              </section>
            </Provider>
          )}
          <p className="demo-footnote">
            Start recording in the Timeline tab, change the counter, then restore a snapshot.
          </p>
          {embedded && (
            <section className="demo-inline">
              <iframe title="Jotai inspector" src="/__jotai-devtools/" />
            </section>
          )}
        </main>
      </div>
      <JotaiDevtools name="Application" options={{ snapshotHistoryLimit: 30 }} />
    </>
  );
}
