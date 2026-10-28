import { connectPanelChannel, type PanelChannel } from "devframe/in-page-channel";
import { useEffect, useRef, useState, type ReactNode } from "react";

import {
  CHANNEL_NAME,
  PROTOCOL_VERSION,
  type AtomDetails,
  type JotaiChannelProtocol,
  type RuntimeState,
  type SnapshotDetails,
} from "../src/internal/protocol";
import { formatValue, type ValueNode } from "../src/internal/values";

function Ghost() {
  return (
    <svg viewBox="0 0 24 24" width="23" height="23" fill="none" aria-hidden="true">
      <path
        d="M5 20V10a7 7 0 0 1 14 0v10l-3-2-4 2-4-2-3 2Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="9.5" cy="10.5" r="1" fill="currentColor" />
      <circle cx="14.5" cy="10.5" r="1" fill="currentColor" />
    </svg>
  );
}
function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Ghost />
      </div>
      <h2>{title}</h2>
      <div className="muted">{children}</div>
    </div>
  );
}
function Tree({ node, expanded = false }: { node: ValueNode; expanded?: boolean }) {
  if (!node.entries?.length)
    return (
      <span className={`value value-${node.kind}`}>
        {node.text}
        {node.truncated ? <span className="muted"> · truncated ({node.truncated})</span> : null}
      </span>
    );
  return (
    <details className="tree" open={expanded}>
      <summary>
        <span className={`value value-${node.kind}`}>{node.text}</span>
        {node.id && <span className="object-id">#{node.id}</span>}
      </summary>
      <div className="tree-children">
        {node.entries.map((entry, index) => (
          <div className="tree-entry" key={`${index}:${entry.key}`}>
            <span className="property">{entry.key}: </span>
            <Tree node={entry.value} expanded={expanded} />
          </div>
        ))}
        {node.truncated ? (
          <div className="muted">… {node.truncated} more entries (inspection limited)</div>
        ) : null}
      </div>
    </details>
  );
}
function ValueView({ value, expanded }: { value: ValueNode; expanded: boolean }) {
  const [mode, setMode] = useState("tree");
  return (
    <>
      <div className="section-heading">
        <h3>Value</h3>
        <div className="segmented" aria-label="Value display">
          {["tree", "raw"].map((m) => (
            <button key={m} className={mode === m ? "selected" : ""} onClick={() => setMode(m)}>
              {m === "tree" ? "Tree" : "Raw"}
            </button>
          ))}
        </div>
      </div>
      <div className="value-box">
        {mode === "tree" ? (
          <Tree node={value} expanded={expanded} />
        ) : (
          <pre>{formatValue(value)}</pre>
        )}
      </div>
    </>
  );
}
function loadTheme(): string {
  try {
    return localStorage.getItem("jotai-devtools:theme") ?? "system";
  } catch {
    return "system";
  }
}

export function App() {
  const [channel, setChannel] = useState<PanelChannel<JotaiChannelProtocol> | null>(null);
  const [status, setStatus] = useState("connecting");
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [hint, setHint] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [tab, setTab] = useState("atoms");
  const [query, setQuery] = useState("");
  const [atomId, setAtomId] = useState<string | null>(null);
  const [snapshotId, setSnapshotId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AtomDetails | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDetails | null>(null);
  const [privateOverride, setPrivateOverride] = useState<boolean | null>(null);
  const [theme, setTheme] = useState(loadTheme);
  const [width, setWidth] = useState(250);
  const [entries, setEntries] = useState(50);
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const store = runtime?.stores.find((s) => s.id === storeId) ?? runtime?.stores[0];
  const target = runtime && store ? { sessionId: runtime.sessionId, storeId: store.id } : null;
  const ready =
    !!channel && status === "connected" && runtime?.protocolVersion === PROTOCOL_VERSION;
  const showPrivate = privateOverride ?? store?.options.shouldShowPrivateAtoms ?? false;
  const expanded = expandedOverride ?? store?.options.shouldExpandJsonTreeViewInitially ?? false;
  const atoms =
    store?.atoms.filter(
      (a) =>
        (showPrivate || !a.private) &&
        `${a.label} ${a.id} ${a.preview}`.toLowerCase().includes(query.toLowerCase()),
    ) ?? [];
  const history =
    store?.history.filter((h) =>
      `${h.id} ${new Date(h.timestamp).toLocaleTimeString()} ${h.changed} ${h.searchText}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];

  useEffect(() => {
    const client = connectPanelChannel<JotaiChannelProtocol>({
      name: CHANNEL_NAME,
      functions: {},
      events: {},
    });
    let active = true;
    let stopState: (() => void) | undefined;
    setChannel(client);
    setStatus(client.status);
    const stopStatus = client.events.on("status:updated", (value) => {
      if (active) setStatus(value);
    });
    void client.whenConnected(3000).catch(() => {
      if (active) setHint(true);
    });
    void client.sharedState
      .get("runtime")
      .then((state) => {
        const apply = (value: unknown) => {
          if (!active) return;
          const next = value as RuntimeState;
          setRuntime(next);
          setHint(false);
          if (next.protocolVersion !== PROTOCOL_VERSION)
            setError(
              "Panel and application protocol versions differ. Update both to the same package version.",
            );
        };
        apply(state.value());
        stopState = state.on("updated", apply);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
      stopState?.();
      stopStatus();
      client.close();
    };
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("jotai-devtools:theme", theme);
    } catch {
      /* Preferences are optional. */
    }
  }, [theme]);
  useEffect(() => {
    setAtomId(null);
    setSnapshotId(null);
    setDetail(null);
    setSnapshot(null);
    setEntries(50);
  }, [runtime?.sessionId, store?.id]);
  useEffect(() => {
    if (store?.selectedSnapshotId) setSnapshotId(store.selectedSnapshotId);
  }, [store?.selectedSnapshotId]);
  useEffect(() => {
    if (!channel || !target || !atomId || !ready) {
      setDetail(null);
      return;
    }
    let active = true;
    void channel
      .call("getAtom", { ...target, atomId, entries, depth: entries > 50 ? 12 : 6 })
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((reason) => {
        if (active) {
          setDetail(null);
          setError(String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [channel, runtime?.sessionId, store?.id, store?.revision, atomId, entries, ready]);
  useEffect(() => {
    if (
      !channel ||
      !target ||
      !snapshotId ||
      !ready ||
      !store?.history.some((h) => h.id === snapshotId)
    ) {
      setSnapshot(null);
      return;
    }
    let active = true;
    void channel
      .call("getSnapshot", { ...target, snapshotId })
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((reason) => {
        if (active) {
          setSnapshot(null);
          setError(String(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [channel, runtime?.sessionId, store?.id, snapshotId, store?.history, ready]);

  async function action(work: (client: PanelChannel<JotaiChannelProtocol>) => Promise<unknown>) {
    if (!channel || !ready) return;
    setError(null);
    try {
      await work(channel);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }
  function restore(id: string) {
    if (target) void action((c) => c.call("restoreSnapshot", { ...target, snapshotId: id }));
  }
  const currentIndex = Math.max(
    0,
    store?.history.findIndex((h) => h.id === (snapshotId ?? store.selectedSnapshotId)) ?? 0,
  );
  const visibleDetail = detail && (showPrivate || !detail.atom.private) ? detail : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Ghost />
          </span>
          <strong>Jotai</strong>
          <span className="brand-subtitle">Devtools</span>
        </div>
        <div className="topbar-right">
          <span className={`connection ${ready ? "live" : ""}`}>
            <i />
            {ready
              ? "Connected"
              : status === "connecting" && runtime
                ? "Reconnecting"
                : "Connecting"}
          </span>
          <select aria-label="Theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="system">System theme</option>
            <option value="light">Light theme</option>
            <option value="dark">Dark theme</option>
          </select>
        </div>
      </header>
      {error && (
        <div className="error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
      {!store ? (
        <Empty title={hint ? "Connect your application" : "Waiting for a Jotai store"}>
          <p>
            Add <code>&lt;JotaiDevtools /&gt;</code> inside your Jotai Provider or alongside your
            application.
          </p>
          <p>
            Open this panel in your application's devtools dock or a same-origin popup opened by the
            application.
          </p>
          <p className="small">
            The inspector renders here. Your application needs no inspector CSS.
          </p>
        </Empty>
      ) : (
        <>
          <div className="workspace-bar">
            <label className="store-picker">
              <span className="eyebrow">STORE</span>
              <select
                aria-label="Store"
                value={store.id}
                onChange={(e) => {
                  setStoreId(e.target.value);
                  setQuery("");
                }}
              >
                {runtime?.stores.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="workspace-stats">
              <span>{store.atoms.length} atoms</span>
              <span>{store.history.length} snapshots</span>
            </div>
          </div>
          {!store.complete && (
            <div className="warning">
              Discovery is incomplete: this store existed before instrumentation. Import{" "}
              <code>@afcms/jotai-devframe/register</code> before application modules, then reload.
            </div>
          )}
          <nav className="tabs" aria-label="Inspector views">
            {["atoms", "timeline"].map((t) => (
              <button
                aria-current={tab === t ? "page" : undefined}
                className={tab === t ? "active" : ""}
                key={t}
                onClick={() => {
                  setTab(t);
                  setQuery("");
                }}
              >
                {t === "atoms" ? "Atoms" : "Timeline"}
                <span className="count">
                  {t === "atoms"
                    ? store.atoms.filter((a) => showPrivate || !a.private).length
                    : store.history.length}
                </span>
              </button>
            ))}
            <label className="private-toggle">
              <input
                type="checkbox"
                checked={showPrivate}
                onChange={(e) => setPrivateOverride(e.target.checked)}
              />
              Private atoms
            </label>
          </nav>
          <div className="workspace">
            <aside className="sidebar" style={{ width }}>
              <div className="search-wrap">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label={tab === "atoms" ? "Search atoms" : "Search snapshots"}
                  placeholder={tab === "atoms" ? "Search atoms…" : "Search time or atom…"}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              {tab === "atoms" ? (
                <div className="items" aria-label="Atoms">
                  {atoms.map((a) => (
                    <button
                      className={`list-item ${atomId === a.id ? "active" : ""}`}
                      key={a.id}
                      onClick={() => {
                        setAtomId(a.id);
                        setEntries(50);
                      }}
                    >
                      <div className="item-title">
                        <span className={`atom-dot status-${a.status}`} />
                        <span>{a.label}</span>
                        {a.private && <span className="tag">private</span>}
                      </div>
                      <div className="item-preview">{a.preview}</div>
                    </button>
                  ))}
                  {!atoms.length && (
                    <p className="list-empty">{query ? "No matching atoms" : "No mounted atoms"}</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="history-tools">
                    <button
                      className={store.recording ? "record recording" : "record"}
                      disabled={!ready}
                      onClick={() =>
                        target &&
                        void action((c) =>
                          c.call("setRecording", { ...target, recording: !store.recording }),
                        )
                      }
                    >
                      <i />
                      {store.recording ? "Stop recording" : "Record"}
                    </button>
                    <button
                      disabled={!ready || !store.history.length}
                      onClick={() => target && void action((c) => c.call("clearHistory", target))}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="items" aria-label="Snapshots">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        className={`list-item ${snapshotId === h.id ? "active" : ""}`}
                        onClick={() => setSnapshotId(h.id)}
                      >
                        <div className="item-title">
                          <span className="snapshot-number">{h.id.slice(1).padStart(2, "0")}</span>
                          <span>{new Date(h.timestamp).toLocaleTimeString()}</span>
                          {store.selectedSnapshotId === h.id && (
                            <span className="tag">restored</span>
                          )}
                        </div>
                        <div className="item-preview">
                          {h.changed} {h.changed === 1 ? "change" : "changes"}
                        </div>
                      </button>
                    ))}
                    {!history.length && (
                      <p className="list-empty">
                        {query ? "No matching snapshots" : "Start recording to capture changes."}
                      </p>
                    )}
                  </div>
                </>
              )}
            </aside>
            <div
              className="resize-handle"
              role="separator"
              aria-label="Resize sidebar"
              aria-orientation="vertical"
              aria-valuemin={160}
              aria-valuemax={600}
              aria-valuenow={width}
              tabIndex={0}
              onPointerDown={(e) => {
                drag.current = { x: e.clientX, width };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (drag.current)
                  setWidth(
                    Math.min(600, Math.max(160, drag.current.width + e.clientX - drag.current.x)),
                  );
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
              onPointerCancel={() => {
                drag.current = null;
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setWidth((w) =>
                    Math.min(600, Math.max(160, w + (e.key === "ArrowRight" ? 20 : -20))),
                  );
                }
              }}
            />
            <main className="detail">
              {tab === "atoms" ? (
                visibleDetail ? (
                  <>
                    <div className="detail-heading">
                      <div>
                        <span className="eyebrow">ATOM INSPECTOR</span>
                        <h1>{visibleDetail.atom.label}</h1>
                      </div>
                      <span className={`state-tag status-${visibleDetail.atom.status}`}>
                        {visibleDetail.atom.status}
                      </span>
                    </div>
                    <div className="metadata">
                      <div>
                        <span>Type</span>
                        <code>{visibleDetail.atom.type}</code>
                      </div>
                      <div>
                        <span>Identity</span>
                        <code>{visibleDetail.atom.id}</code>
                      </div>
                      <div>
                        <span>Kind</span>
                        <code>{visibleDetail.atom.primitive ? "Primitive" : "Derived"}</code>
                      </div>
                    </div>
                    <div className="section-heading">
                      <h3>Inspection</h3>
                      <label className="small">
                        <input
                          type="checkbox"
                          checked={expanded}
                          onChange={(e) => setExpandedOverride(e.target.checked)}
                        />{" "}
                        Expand tree
                      </label>
                    </div>
                    <ValueView value={visibleDetail.value} expanded={expanded} />
                    <button
                      className="text-button"
                      disabled={entries >= 1000}
                      onClick={() => setEntries(1000)}
                    >
                      Inspect deeper · up to 1,000 entries per object
                    </button>
                    {(["dependencies", "dependents"] as const).map((direction) => (
                      <section key={direction}>
                        <h3>{direction === "dependencies" ? "Dependencies" : "Dependents"}</h3>
                        <div className="relations">
                          {visibleDetail.atom[direction].flatMap((id) => {
                            const related = store.atoms.find((a) => a.id === id);
                            return related && (showPrivate || !related.private)
                              ? [
                                  <button key={id} onClick={() => setAtomId(id)}>
                                    <span className="atom-dot" />
                                    {related.label}
                                    <span>↗</span>
                                  </button>,
                                ]
                              : [];
                          })}
                          {!visibleDetail.atom[direction].some((id) =>
                            store.atoms.some((a) => a.id === id && (showPrivate || !a.private)),
                          ) && <span className="muted small">None</span>}
                        </div>
                      </section>
                    ))}
                  </>
                ) : (
                  <Empty title="Explore your atoms">
                    <p>Select an atom to inspect its value and relationships.</p>
                    <p className="small">Only atoms mounted by your application are observed.</p>
                  </Empty>
                )
              ) : snapshot ? (
                <>
                  <div className="detail-heading">
                    <div>
                      <span className="eyebrow">SNAPSHOT {snapshot.id.slice(1)}</span>
                      <h1>{new Date(snapshot.timestamp).toLocaleTimeString()}</h1>
                    </div>
                    <button
                      className="primary"
                      disabled={!ready || store.playing}
                      onClick={() => restore(snapshot.id)}
                    >
                      ↶ Restore state
                    </button>
                  </div>
                  <p className="muted small">
                    Restores primitive atom state. External effects and network activity continue.
                  </p>
                  {snapshot.referenceValues > 0 && (
                    <div className="warning">
                      {snapshot.referenceValues} opaque values are retained and restored by
                      reference.
                    </div>
                  )}
                  <section>
                    <h3>
                      Changes{" "}
                      <span className="count">
                        {
                          snapshot.changes.filter(
                            (c) =>
                              showPrivate || !snapshot.privateAtoms.includes(c.path.split(".")[0]!),
                          ).length
                        }
                      </span>
                    </h3>
                    <div className="diff">
                      {snapshot.changes
                        .filter(
                          (c) =>
                            showPrivate || !snapshot.privateAtoms.includes(c.path.split(".")[0]!),
                        )
                        .map((change, i) => (
                          <div className="diff-entry" key={i}>
                            <div className="diff-path">
                              {snapshot.labels[change.path.split(".")[0]!] ??
                                change.path.split(".")[0]}
                              {change.path.includes(".")
                                ? change.path.slice(change.path.indexOf("."))
                                : ""}
                            </div>
                            {change.before !== null && (
                              <pre className="removed">− {change.before}</pre>
                            )}
                            {change.after !== null && <pre className="added">+ {change.after}</pre>}
                          </div>
                        ))}
                      {!snapshot.changes.length && <p className="muted">No value changes.</p>}
                    </div>
                  </section>
                  <section>
                    <h3>Snapshot values</h3>
                    {Object.entries(snapshot.values)
                      .filter(([id]) => showPrivate || !snapshot.privateAtoms.includes(id))
                      .map(([id, value]) => (
                        <details className="snapshot-value" key={id}>
                          <summary>{snapshot.labels[id] ?? id}</summary>
                          <ValueView value={value} expanded={expanded} />
                        </details>
                      ))}
                  </section>
                </>
              ) : (
                <Empty title="A history of your state">
                  <p>Record changes, compare snapshots, and travel through atom state.</p>
                  <p className="small">
                    History stays in this application tab. Default retention: 30 snapshots.
                  </p>
                </Empty>
              )}
            </main>
          </div>
          {tab === "timeline" && (
            <footer className="playbar">
              <button
                aria-label={store.playing ? "Pause playback" : "Play snapshots"}
                disabled={!ready || !store.history.length}
                onClick={() =>
                  target &&
                  void action((c) => c.call("setPlayback", { ...target, playing: !store.playing }))
                }
              >
                {store.playing ? "Ⅱ" : "▶"}
              </button>
              <button
                aria-label="Previous snapshot"
                disabled={!ready || currentIndex <= 0 || store.playing}
                onClick={() => {
                  const h = store.history[currentIndex - 1];
                  if (h) restore(h.id);
                }}
              >
                ‹
              </button>
              <input
                type="range"
                aria-label="Time travel"
                min={0}
                max={Math.max(0, store.history.length - 1)}
                value={currentIndex}
                disabled={!ready || !store.history.length || store.playing}
                onChange={(e) => {
                  const h = store.history[Number(e.target.value)];
                  if (h) restore(h.id);
                }}
              />
              <button
                aria-label="Next snapshot"
                disabled={!ready || currentIndex >= store.history.length - 1 || store.playing}
                onClick={() => {
                  const h = store.history[currentIndex + 1];
                  if (h) restore(h.id);
                }}
              >
                ›
              </button>
              <span className="small muted">
                {store.history.length ? currentIndex + 1 : 0} / {store.history.length}
              </span>
              <select
                aria-label="Playback speed"
                disabled={!ready}
                value={store.speed}
                onChange={(e) =>
                  target &&
                  void action((c) =>
                    c.call("setPlayback", {
                      ...target,
                      playing: store.playing,
                      speed: Number(e.target.value),
                    }),
                  )
                }
              >
                {[0.5, 1, 1.5, 1.75, 2].map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}×
                  </option>
                ))}
              </select>
            </footer>
          )}
          <footer className="statusbar">
            <span>
              <i className="atom-dot" />
              {store.name}
            </span>
            <span>
              {store.complete ? "Observing mounted atoms" : "Partial discovery"}
              <span className="status-separator">·</span>Page session{" "}
              {runtime?.sessionId.slice(0, 8)}
            </span>
          </footer>
        </>
      )}
    </div>
  );
}
