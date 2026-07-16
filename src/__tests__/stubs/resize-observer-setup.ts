// Global Vitest setup (wired via vitest.config.mts's `test.setupFiles`) —
// jsdom has no ResizeObserver. Most components that need one (Radix's
// Switch, via @radix-ui/react-use-size) only touch it inside a render-time
// hook, so a PER-TEST-FILE `vi.stubGlobal("ResizeObserver", ...)` call is
// early enough. M6-T4 (email-block-designer.tsx's `<Puck>` import) changed
// that: `@dnd-kit/dom` (a transitive dependency of `@measured/puck`)
// references `ResizeObserver` at MODULE TOP-LEVEL, evaluated the moment
// anything imports `@measured/puck` — which happens BEFORE a test file's
// own top-level `vi.stubGlobal` call ever runs, because ES module imports
// are hoisted/resolved ahead of a file's own statements. `setupFiles` is
// the one place Vitest guarantees runs before a test file (and its full
// import graph) is loaded, so this is the only stub location early enough
// to cover it. Additive/no-op for every other test — only defines the
// global if the environment doesn't already provide one.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver;
}
