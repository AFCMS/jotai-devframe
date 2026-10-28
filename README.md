# @afcms/jotai-devframe

Jotai devtools with a headless application component and a separate Devframe panel. Inspect live atoms, compare snapshots, and restore atom state inside Vite Devtools or another Devframe host. No inspector CSS imports or inspector DOM are added to your application.

Experimental. The inspection adapter currently targets **Jotai 3.0.1** exactly. The integration baseline is Devframe 1.2.6 and Vite Devtools 0.8.0. React 18 and 19 are supported.

## Vite Devtools

Install alongside your application's React and Jotai dependencies:

```sh
pnpm add -D @afcms/jotai-devframe @vitejs/devtools@0.8.0 @vitejs/devtools-kit@0.8.0
```

Register the panel in your Vite configuration, keeping your existing application plugins:

```ts
import { jotaiDevtools } from "@afcms/jotai-devframe/vite";
import { DevTools } from "@vitejs/devtools";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [DevTools(), jotaiDevtools()],
});
```

Register the store from your application:

```tsx
import { JotaiDevtools } from "@afcms/jotai-devframe";
import { Provider } from "jotai";

export function Root() {
  return (
    <Provider>
      <JotaiDevtools name="Application" />
      <App />
    </Provider>
  );
}
```

Open the Jotai entry in the Vite Devtools dock. The component renders `null`. It also works without a Provider, using Jotai's default store. An explicit `store` prop takes precedence over the nearest Provider.

Use one component per store to inspect multiple stores. Duplicate components referring to the same store share its registration; the first active registration supplies its name and options. Store identity is independent of its label.

## Component options

```tsx
<JotaiDevtools
  store={customStore}
  name="Editor"
  enabled={true}
  options={{
    shouldShowPrivateAtoms: false,
    shouldExpandJsonTreeViewInitially: false,
    timeTravelPlaybackInterval: 750,
    snapshotHistoryLimit: 30,
  }}
/>
```

Recording is off until started in the Timeline tab. The history limit accepts a positive integer or an explicit `Infinity`; the playback interval must be at least 16 ms. Component option changes retain the store's identity and trim retained history when the limit decreases.

The Atoms tab has search, raw/tree value inspection, async/error status, private-atom filtering, and dependency/dependent navigation. The Timeline tab has search by time or changed atom label, snapshot diffs, restoration, playback, scrubbing, and recording controls. Resize the sidebar with the separator or its arrow keys. Theme selection supports system, light, and dark modes.

## Early instrumentation and custom stores

Importing the component, utility hooks, or runtime installs development-only instrumentation. The adapter chains Jotai's existing store factory and observes mounts without mounting additional atoms.

Stores created and used before instrumentation can only be discovered partially: Jotai keeps their atom state in non-enumerable WeakMaps. The panel reports incomplete discovery. Put this import before application modules and reload to collect all mounts:

```ts
// Application entry, before modules that create or mount stores.
import "@afcms/jotai-devframe/register";
import "./application";
```

The adapter depends on Jotai's unstable Rev4 internals. A store from another Jotai installation is rejected with a diagnostic. Use one matching Jotai installation for the application and inspector.

## Compatible utility hooks

All five existing hook names are available from the package root and `/utils`:

```tsx
import {
  useAtomsSnapshot,
  useGotoAtomsSnapshot,
  useAtomsDebugValue,
  useAtomDevtools,
  useAtomsDevtools,
} from "@afcms/jotai-devframe/utils";
```

`useAtomsSnapshot({ store?, shouldShowPrivateAtoms? })` returns `{ values: Map<Atom, unknown>, dependents: Map<Atom, Set<Atom>> }`. `useGotoAtomsSnapshot({ store? })` returns a callback accepting that same snapshot shape. Snapshot and restore hooks operate on actual application atom references; the panel uses opaque identifiers instead.

`useAtomsDebugValue({ store?, enabled? })` exposes atom values, errors, and dependents to React Devtools. `useAtomDevtools(atom, { store?, name?, enabled?, ...useAtomOptions })` and `useAtomsDevtools(name, { store?, enabled?, shouldShowPrivateAtoms? })` connect to an installed Redux Devtools browser extension. They work independently of the Devframe panel. Single-atom integration supports actions, jumps, commit, and state import; whole-store integration supports jumps, commit, and recording pause. Cleanup affects the hook's own connection.

Hooks are safe during SSR and become no-ops in production. Redux Devtools serialization remains governed by the browser extension; the panel's safe value descriptors are a separate boundary.

## Other hosts and build tools

The definition and browser runtime have no Vite dependency. Mount the same definition using Devframe's standard handler:

```ts
import { createJotaiDevframe } from "@afcms/jotai-devframe/devframe";
import { initDevframe } from "devframe/initiate";

const inspector = initDevframe(createJotaiDevframe(), {
  base: "/__jotai-devtools/",
});

// Connect/Express-compatible host:
app.use(inspector.nodeMiddleware);

// Fetch-compatible host: mount inspector.handler on the same base.
// On host shutdown: await inspector.close().
```

Mount development tooling only in development. Serve the panel on the application's origin, then embed it in a host-provided iframe or open it from the application:

```ts
window.open("/__jotai-devtools/", "jotai-inspector", "popup,width=1050,height=760");
```

`createJotaiDevframe` and `jotaiDevtools` accept `id`, `name`, `icon`, and `basePath`. The generic handler's `base` is explicit; use that same path for any popup or iframe. The packaged panel uses relative asset URLs, so it can be mounted under another path without rebuilding.

For React-free application code, register a Jotai vanilla store directly:

```ts
import { attachJotaiStore } from "@afcms/jotai-devframe/runtime";

const detach = attachJotaiStore(store, { name: "Vanilla store" });
// When the store is no longer exposed:
detach();
```

The `/devframe` entry can be imported on Node without React or Jotai installed. React, Jotai, Vite, and the Vite kit are optional peers because different entry points use different hosts. Install the peers needed by the entry you use.

## State ownership and time travel

The application runtime owns inspection and history. The React panel communicates through `devframe/in-page-channel`; the server serves its assets. Atom values are not relayed through Node or exposed through an agent API.

Transport values are bounded, tagged descriptors that safely describe collections, cycles, functions, symbols, bigint, errors, and promise states. Ordinary getters are displayed without invocation. Large values show truncation; live inspection can request deeper expansion.

Snapshot display data is captured immutably. Supported restoration values are cloned; opaque values are retained by reference and identified in the snapshot. Restoring batches primitive atom state and lets Jotai recompute derived atoms. In-place mutations of opaque values cannot be undone. External effects, subscriptions, network activity, and non-atom state continue.

History survives panel reloads and is shared by connected panels. Closing the final panel stops playback; recording continues if explicitly enabled. A full application reload starts a new session and clears history. Removing the final store registration disposes that store's history and retained restoration values. Commands from an expired session are rejected.

The first release supports embedded docks and related same-origin popups. The default handshake discovers ancestor frames and openers. An independently opened inspector tab or a Chrome extension panel needs an additional transport and is outside this release. A panel without an instrumented application shows setup instructions and keeps trying to connect.

## Production builds and migration

The `production` export condition selects tiny no-op browser entry points. Vite selects this automatically for production builds. With esbuild, set `conditions: ["production"]` and define `process.env.NODE_ENV` as `"production"`; the Node example demonstrates both. The normal entries also guard instrumentation and channels with `NODE_ENV` for hosts without conditional exports.

When migrating from `jotai-devtools`:

1. Replace `<DevTools />` with `<JotaiDevtools />` and register the panel with your host.
2. Remove `jotai-devtools/styles.css` and any inspector-specific style injection.
3. Change utility-hook imports to this package. Preserve the `{ values, dependents }` snapshot shape.
4. Move theme selection to the panel. Page-specific `position`, `isInitialOpen`, and `nonce` props are replaced by the host's panel UI and its own assets.

Jotai Babel/SWC debug-label and atom-refresh integrations remain useful and independent of this package.

## Development and validation

Use Node 24 and pnpm 12:

```sh
pnpm install
pnpm build
pnpm example:vite  # http://127.0.0.1:5173
pnpm example:node  # http://127.0.0.1:4488
```

The Vite example uses the real Vite Devtools dock. The Node example uses esbuild, a plain HTTP server, and an embedded panel. Both include custom stores, private values, derived and async state, and non-JSON collections. Both can open a related popup.

`pnpm dev` watches the library and panel assets; run an example separately and reload its panel after asset changes. Panel development stays on the application's origin.

```sh
pnpm typecheck
pnpm test
pnpm test:package
pnpm lint
pnpm format:check
```

Builds run strict publint and Are The Types Wrong checks. The tests cover runtime behavior, compatible hooks, Redux extension messages, serialization, SSR, and UI restoration through real MessagePorts. Package tests extract a tarball into a separate consumer, build both examples, serve both hosts, check assets and CSS isolation, and verify production removal. CI also runs the tests with React 18.3.1. Chrome MCP can be used for visual and browser lifecycle acceptance when a Chrome session is connected.

## Design references

- [Devframe in-page channel](https://devfra.me/guide/in-page-channel): typed calls, per-panel ports, shared-state replay, and reconnects.
- [Devframe a11y inspector](https://github.com/devframes/devframe/tree/main/plugins/a11y): the page-runtime/separate-SPA pattern.
- [Vite's Devframe adapter](https://github.com/vitejs/devtools/blob/main/packages/kit/src/node/create-plugin-from-devframe.ts): hosting a portable definition inside the dock.
- [Vite React file-explorer example](https://github.com/vitejs/devtools/tree/main/examples/plugin-file-explorer): a dedicated iframe SPA for richer interactions.
- [Official Jotai devtools](https://github.com/jotaijs/jotai-devtools): the utility-hook API and feature baseline. This rewrite shares one adapter across those APIs and the panel.

The React SPA gives the inspector direct browser interactions and rich value/diff rendering; JSON Render's server action model and built-in catalog would require substantial custom extensions for this workflow. Packaged local assets keep the panel usable without an external UI service.
