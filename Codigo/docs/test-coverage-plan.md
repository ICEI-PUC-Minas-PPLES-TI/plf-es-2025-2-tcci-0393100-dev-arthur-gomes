# Test-Coverage Plan — OpenAPI → TS SDK Generator

## 1. Executive Summary

Today's 21 cases across 5 files cover the *generator output as strings* and a couple of parsers, but leave three structural gaps that matter for a code-generation product:

- **The parsing front-end is largely untested.** `SchemaParser`, `PathParser`, and `OpenAPIValidator` are pure, branch-dense transformers that feed everything downstream. A silent regression here corrupts every generated file. They are the cheapest, highest-leverage tests in the repo (zero mocks, plain object fixtures).
- **There is no compile-check harness.** The generators are only asserted as strings. Two *known* cross-module bugs (empty-`responses[]` → dangling `Types.<Fn>Response200`; `hasRequiredArgs` divergence between SDK and React-Query) produce output that string tests pass but `tsc` rejects. For a tool whose entire job is emitting compilable TypeScript, "does the emitted bundle type-check?" is the single most important missing test.
- **The orchestration + activation layer (`ExtensionController`, `extension.ts`) has zero coverage** and hides at least one real behavioral bug (the adapter-reset side effect in `updateConfig`). The webview glue (`SidebarViewProvider`) is mostly an inert HTML string and low-value to test directly.

Recommended sequence: lock the pure parsers first (fast wins), stand up the compile-check harness (highest defect-catching value), then the orchestration bugs, then the thin UI/activation wiring, and finally type-level contract tests once a `typecheck` script exists.

Also note a latent-bug inventory these tests should *pin* (not fix silently): the `$ref: ''` → `'refParameter'` dead-code fallback in `PathParser`; `requestBody` empty-content collapses to `undefined` while responses keep `content:{}`; `FileWriter` nested file-name keys reject with ENOENT; React-Query `args = {}` assignment clobbers caller args; `updateConfig` always forces `adapter:'fetch'`.

---

## 2. Prioritized Work Items

### P1 — `SchemaParser` (pure, zero deps)
- **Target:** `src/services/parsers/SchemaParser.ts`
- **New test file:** `tests/parsers/SchemaParser.test.ts`
- **Cases:** `parseSchemas` key-preservation + `{}` default; scalar `type`/`format` copied only when string; `$ref` early-return **drops sibling fields** (data-loss branch); `nullable` present for both `true` and `false`, stripped for non-boolean; `required` array filtered to strings (partial keep, not raw passthrough); `enum` keeps string/number/boolean/**null**, drops objects/arrays; array `items` — `$ref` preserved, inline gets `${name}Item` fallback, `items:true` enters-but-drops, `items:null` skips; nested `properties` recurse with concatenated `${name}${prop}` names, non-object property values omitted, array/non-object `properties` ignored; non-object `rawSchema` → name-only; `parseRefOrInline` returns `undefined` for non-object (load-bearing for callers) and non-string `$ref` falls through to inline.
- **Mocks:** none.
- **Effort:** **S**

### P2 — `PathParser`
- **Target:** `src/services/parsers/PathParser.ts`
- **New test file:** `tests/parsers/PathParser.test.ts`
- **Cases:** one Operation per supported method, `head/options/trace` silently dropped (no throw, no warning — warning lives in `OpenAPILoader`); non-object path items / operation values skipped; scalar metadata (`operationId`/`summary`/`description`/`tags`) mapped only when correctly typed; `asStringArray` filters non-strings, empty → `undefined` (not `[]`); path-level params merge into every op, operation-level overrides same `in:name` key while distinct-location same-name coexist; `required` default location-dependent (path→true, else→false, non-boolean falls back, explicit `false` preserved); invalid params skipped; `$ref` param resolves to last segment; **BUG-GUARD** `$ref:''` → empty name (pins dead `'refParameter'` fallback); param schema delegated with `${name}ParamSchema`; requestBody media-type fallback sanitization (`applicationjsonRequestBody`); **requestBody empty-content collapses to `undefined`** vs **response empty-content stays `{}`** (asymmetry); response ordering + statusCode string keys; empty paths → `[]`.
- **Mocks:** prefer **real `SchemaParser`** (black-box); use `{ parseRefOrInline: vi.fn() } as unknown as SchemaParser` only for the exact-`fallbackName` delegation assertions.
- **Effort:** **M**

### P3 — `OpenAPIValidator`
- **Target:** `src/services/parsers/OpenAPIValidator.ts`
- **New test file:** `tests/parsers/OpenAPIValidator.test.ts`
- **Cases:** non-object docs (incl. array) → single exact error; missing/non-`3.x` version (`'3'` no-dot fails `startsWith('3.')`, numeric `openapi` fails typeof) → exact error; valid 5-method path → `valid:true`, no warnings; `head/options/trace` → one "not supported in V1" warning each, **still valid**; missing/empty/array `paths` → exact error and loop skipped; invalid path-item values warned + skipped, not fatal; unknown path-level keys (`parameters`,`summary`,`$ref`) silently ignored; method keys matched case-insensitively but warning uses original-cased `toUpperCase()`; multiple errors accumulate (no short-circuit); `valid` derived only from `errors.length`.
- **Mocks:** none.
- **Effort:** **S**

### P4 — Compile-Check Harness + Generator Behavioral Tests
This is the flagship item. See **Section 3** for the harness design.
- **Targets:** `src/services/generators/TypeGenerator.ts`, `SDKGenerator.ts`, `ReactQueryGenerator.ts`
- **New test files:**
  - `tests/helpers/compileHarness.ts` (shared in-memory `ts.CompilerHost` helper — not a spec)
  - `tests/generators/CompileCheck.test.ts` (Tier A + Tier B)
  - `tests/generators/TypeGenerator.test.ts`, `tests/generators/SDKGenerator.test.ts`, `tests/generators/ReactQueryGenerator.test.ts` (or extend the existing `tests/generators/TypeAndSdkGenerator.test.ts` — but see infra note: it imports non-existent `OperationModel`/`SchemaModel`; switch to real `Operation`/`Schema`).
- **Behavioral cases (string-level):**
  - *TypeGenerator:* interface-vs-type-alias selection; empty-object fallback `{ [key: string]: unknown; }`; nullable `(base) | null`; array-of-ref `(Tag)[]`; `quoteKeyIfNeeded` for `'X-Request-Id'`; response edges (204 → `void` before content lookup, missing status, no-json → `unknown`, ref resolves); `RequestArgs` shape by param location + body-required.
  - *SDKGenerator:* `BASE_URL` present vs absent; args-required inference; conditional header/`Content-Type`/body wiring; transport selection (axios vs fetch, **react-query reuses fetch transport**).
  - *ReactQueryGenerator:* get→query / non-get→mutation routing + hook naming; **BUG-GUARD** `args = {}` assignment in query key/options/hook call sites.
- **Compile-check cases:** Tier B fetch bundle type-checks (0 diagnostics); Tier B react-query module against stubbed `@tanstack`; **negative control**: empty-`responses[]` op yields `TS2339/2551` on `Types.PingResponse200` (distinguish from `TS2307` module-resolution); Tier A `transpileModule` syntactic smoke on each file (both transport variants).
- **Mocks:** none for behavioral; virtual `.d.ts` stubs for `axios` and `@tanstack/react-query` in the harness (do **not** install them).
- **Effort:** **L** (harness **M**, behavioral cases **S–M**)

### P5 — `ExtensionController`
- **Target:** `src/ui/ExtensionController.ts`
- **New test file:** `tests/ui/ExtensionController.test.ts`
- **Cases:** `getUIConfig` mapping + `hasOpenAPI` true/false; `updateConfig` trims/empties baseURL & outputPath; **BUG-GUARD** `updateConfig` always forces `adapter:'fetch'` when absent (and `setBaseUrl`/`setOutputPath`/`runImportOpenAPI` propagate the reset); `reloadOpenAPI` no-importPath error vs delegation; `runImportOpenAPI` empty-source reject, loader-failure error+warnings surfacing, `{success:true,openAPI:undefined}` fallback message, success persists config with trimmed `importPath`+`openAPI` and reports counts; `runGenerateMethods` no-openAPI error; fetch adapter writes exactly `types/transport/api/index`, react-query adds `react-query.ts`+index export; **resolved** ops (from `resolveAll`) reach `createTypes`/`SDKGenerator.generateMethods`; default outputPath → `join(workspaceRoot,'generated-sdk')`; override-wins vs whitespace-fallback in `prepareGeneration`; `SDKGenerator` constructed with `{...runtimeConfig, outputPath}`; `writeArtifacts` throw → `Error.message` vs non-Error → `'Unknown file writing error.'`; `runGenerateTypes` writes only `types.ts` and skips SDK/RQ.
- **Mocks:** `vi.mock('vscode', () => ({}))` (required — static `ConfigManager` import pulls in `vscode` at module-eval). Six injected collaborators as plain `vi.fn()` stubs. `SDKGenerator` is `new`-ed internally — run the real (pure) class for integration cases or `vi.mock` it to assert ctor config/args. `node:path` real.
- **Effort:** **M**

### P6 — `FileWriter` (extend the existing 1-test file)
- **Target:** `src/services/generators/FileWriter.ts`
- **File:** `tests/generators/FileWriter.test.ts` (extend)
- **Cases:** writes all files verbatim + utf8; returns absolute `resolve(join(...))` paths in insertion order; overwrite truncates (assert old value **absent**); recursive `mkdir` for multi-segment new path; **BUG-GUARD** nested file-name key (`'sub/models/user.ts'`) rejects ENOENT (only `outputPath` is mkdir'd); unicode/emoji round-trip; empty files map → dir created + `[]`; **error paths** via `vi.mock('node:fs/promises')`: `mkdir` rejection short-circuits (writeFile never called), `writeFile` rejection aborts loop (called exactly twice of three).
- **Mocks:** real fs via `mkdtemp` for happy paths (cleanup array + `rm` in `afterEach`); `vi.mock('node:fs/promises')` for the two error cases only.
- **Effort:** **S**

### P7 — `extension.ts` (activation + commands)
- **Target:** `src/extension.ts`
- **New test file:** `tests/extension.test.ts`
- **Cases:** creates `'Swagger to SDK'` channel + logs; `workspaceRoot` from first folder vs `globalStorageUri.fsPath` fallback (undefined **and** empty-array cases) and `generated-sdk` path; registers webview provider under `'plf-es-view'`; registers exactly 3 commands; pushes 5 disposables across the two `.push()` calls; import command aborts on `undefined` **and** empty string; import happy path order (`postMessage` → `pushConfig` → `notifyResult`) with exact success string `(N operations, M schemas).`; import error joins with `' | '`; generate success joins files with `', '` (distinct separator); `config:loaded`/`ext:focusStep` → no notification; `changeToExtensionTab` delegates; `deactivate` no-op.
- **Mocks:** `vi.mock('vscode')` (hoisted pattern from `ConfigManager.test.ts`); `vi.mock('./ui/ExtensionController')` and `vi.mock('./ui/SidebarViewProvider')` (**mock must carry static `viewType = 'plf-es-view'`**); `registerCommand` stores `(id, cb)` in a Map so callbacks can be invoked and awaited.
- **Effort:** **M**

### P8 — `SidebarViewProvider` (host-side dispatch only)
- **Target:** `src/ui/SidebarViewProvider.ts`
- **New test file:** `tests/ui/SidebarViewProvider.test.ts`
- **Scope note:** test only the host-side surface. The ~470-line inner webview JS template is **out of scope** (runs in browser, unreachable by Vitest) — see Section 4.
- **Cases:** `postMessage`/`pushConfig` view-guard early returns; `resolveWebviewView` wires options/html/listener and fires `config:loaded` (await a microtask — fire-and-forget `void`); CSP `cspSource` injected + **script-src nonce matches `<script nonce>`**, 32-char, random per resolve; capture the `onDidReceiveMessage` callback and drive all 11 `handleMessage` branches (`ui:ready`, `ui:log` info/error, `ui:updateConfig`, `ui:pickOutputPath` incl. 3-level `defaultUri` fallback + dismissal guards, `ui:import`, `ui:generate` **payload-less optional-chaining**, `ui:generateTypes`, `ui:reload`, `ui:setBaseUrl`/`ui:setAdapter`/`ui:setOutputPath`); catch-all always posts `generate:error` with `Error.message` vs `'Unexpected extension error.'`; `changeToExtensionTab` focuses then posts `ext:focusStep`.
- **Mocks:** `vi.mock('vscode')` stubbing `commands.executeCommand`, `window.showOpenDialog`, `Uri.file`; hand-rolled `ExtensionController` stub; `OutputChannel = {appendLine: vi.fn()}`; fake `WebviewView` whose `onDidReceiveMessage` captures the callback.
- **Effort:** **M** (skip the inner-JS temptation to keep it S–M)

### P9 — `messages.ts` (type-only contract)
- **Target:** `src/ui/messages.ts`
- **New test file:** `tests/ui/messages.test-d.ts`
- **Cases:** `assertType`/`expectTypeOf` with `// @ts-expect-error` negatives for: `ui:generate` payload optional vs `ui:updateConfig` payload **required** (asymmetry); bare variants reject `.payload` after narrowing; `ui:log.level` closed `'info'|'error'`; `ui:import` requires `source`; `AdapterKind` literals enforced (import from `../models/config`, don't redeclare); `UIConfigPayload` required vs optional fields; `ExtensionToUIMessage` numeric `operations`/`schemas`/`step`, `string[]` files/errors, optional `warnings`; exhaustive `never`-switch over both unions (11 + 6).
- **Infra dependency:** **requires** a `vitest typecheck` script (see Section 5) — under plain `vitest run` (esbuild) these are **false-green no-ops**.
- **Effort:** **S** (once typecheck infra exists)

---

## 3. Compile-Check Harness

Because the product emits TypeScript, a harness that feeds generated strings back through `typescript@5.3` (already installed) is the single highest-value addition. Use **two tiers**.

**Shared helper location:** `tests/helpers/compileHarness.ts`, exporting e.g. `transpileCheck(source)` (Tier A) and `programCheck(files: Record<string,string>)` (Tier B). Keep it out of `tests/**/*.test.ts` glob so it isn't collected as a spec.

### Tier A — `ts.transpileModule` (cheap syntactic smoke)
- `ts.transpileModule(source, { reportDiagnostics: true, compilerOptions: { module: CommonJS, target: ES2020 } })`, assert zero `DiagnosticCategory.Error`.
- **Catches:** malformed emit — unbalanced braces from template conditionals, bad escaping in the `buildUrl` regex.
- **Does NOT:** type-check or resolve imports. Run it per file (types, both transport variants, api, react-query) as a fast first gate.

### Tier B — `ts.createProgram` (real cross-module type-check)
- Compile `types.ts + transport.ts + api.ts + react-query.ts` **together** over an in-memory `ts.CompilerHost`.
- Options: `{ strict: true, noEmit: true, skipLibCheck: true, module: CommonJS, target: ES2020, moduleResolution: NodeNext, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'] }`.
- **DOM lib is mandatory** — `transport.ts` uses global `fetch` + `URLSearchParams`; omitting DOM produces false-positive errors unrelated to the generator.
- Assert `getSyntacticDiagnostics() + getSemanticDiagnostics()` is empty.
- **Stub external deps as virtual `.d.ts`** (do **not** install): `axios` (default export `request<T>(config): Promise<{status:number;data:T}>`) and `@tanstack/react-query` (`queryOptions`, `mutationOptions`, `useQuery`, `useMutation`, `UseQueryOptions<...>`, `UseMutationOptions<...>`). Wire via `CompilerHost.resolveModuleNames` (cleaner than `compilerOptions.paths`).
- **CompilerHost must still serve real lib files** — delegate `lib.*.d.ts` to a base host / `ts.getDefaultLibFilePath`.
- **Negative control test** is essential: assert the empty-`responses[]` op fails with `TS2339/2551` on `Types.<Fn>Response200`, and explicitly assert the error is **not** `TS2307` — otherwise a broken stub (missing module) masquerades as a generator bug and gives false confidence.

### Tradeoff summary
| | Tier A `transpileModule` | Tier B `createProgram` |
|---|---|---|
| Speed | Fast, per-file | Slower, whole-bundle |
| Catches | Syntax / malformed emit | Type errors + cross-module reference resolution |
| Import stubs | Not needed | Required (axios, @tanstack) |
| Value | Cheap guard | Catches the two known cross-module bugs |

Run **both**: Tier A as a fast smoke, Tier B as the real correctness gate.

---

## 4. Low-Value-to-Test Modules & How to Make Them Testable

- **`SidebarViewProvider` inner webview JS (~lines 795–1265):** `hydrateState`, `renderInputs`, `pushStatus`, adapter normalization, `isRemoteSource` regex, `basename`, etc. live inside an inert template-literal string executed **only in the browser webview**, never in the extension host. Unreachable by Vitest, uncompilable to import. **Do not** attempt to unit-test it. If coverage of that logic is ever wanted, **extract the pure helpers** (URL/remote-source detection, basename, status-buffer slicing, config→input mapping) into a separate `src/ui/webview/logic.ts` module imported both by the host build tooling and a jsdom/e2e harness — then it becomes a normal pure-function test. Until then, treat `getHtmlContent` output purely as a produced string (CSP/nonce structural invariants only).
- **`messages.ts`:** compiles to an empty JS module — no runtime surface. Only meaningful as compile-check/type-level tests (P9).
- **`extension.ts` activation:** thin DI wiring; the valuable extraction already exists implicitly (services are constructed and injected). Keep it as spy-based wiring tests; the only "logic" worth isolating is `notifyResult`'s message formatting, which is adequately reachable via the command callbacks.

**General principle for the UI layer:** anything that is pure string/format logic buried in a webview or activation function should be pulled into a small pure module so it is directly unit-testable; leave the vscode/webview glue as thin, spy-verified dispatch.

---

## 5. Test-Infra Changes Needed

1. **Coverage tooling:** add `@vitest/coverage-v8` (devDep) and a `test:coverage` script (`vitest run --coverage`). Configure `coverage.exclude` to drop the inert webview JS region and the type-only `messages.ts` so numbers aren't skewed by unreachable/erased code.
2. **Shared vscode mock helper:** extract the `vi.hoisted()` + `vi.mock('vscode')` pattern currently duplicated in `ConfigManager.test.ts` into `tests/helpers/vscodeMock.ts` (stubs for `window.createOutputChannel/showInputBox/showInformationMessage/showErrorMessage/showOpenDialog/registerWebviewViewProvider`, `commands.executeCommand/registerCommand`, `workspace.workspaceFolders`, `Uri.file`). Reused by `ExtensionController`, `SidebarViewProvider`, and `extension.ts` tests.
3. **Compile harness helper:** `tests/helpers/compileHarness.ts` (Section 3) + a `tests/fixtures/` module for the representative `Operation[]`/`Record<string,Schema>` used by both behavioral and compile-check tests.
4. **`vitest typecheck` script + config:** add `"test:types": "vitest --typecheck"` and `test.typecheck.include: ['tests/**/*.test-d.ts']`. **Critical:** the current `vitest run` uses esbuild and does **not** type-check — `assertType`/`expectTypeOf`/`satisfies` are runtime no-ops (false green). P9 is worthless without this. Alternatively (or additionally) a `tsc --noEmit` guard over a fixtures file with `// @ts-expect-error` samples.
5. **Test tsconfig:** ensure a `tsconfig` (or `tsconfig.test.json`) that the `typecheck` step and the compile harness reference. Note the existing `tests/generators/TypeAndSdkGenerator.test.ts` imports non-existent `OperationModel`/`SchemaModel` (survives only because esbuild strips type-only imports without checking). Fix to real `Operation`/`Schema` before enabling any typecheck pass, or CI will fail.
6. **CI wiring:** run `test`, `test:types`, and `test:coverage` as separate steps so a type-contract break can't hide behind a green runtime run.

---

## 6. Suggested Sequencing / Milestones

**Milestone 0 — Infra (unblocks everything):**
Add `@vitest/coverage-v8`; create `tests/helpers/vscodeMock.ts` and `tests/helpers/compileHarness.ts` + `tests/fixtures/`; add `test:types` script + typecheck config; fix the `OperationModel`/`SchemaModel` import in the existing generator test.

**Milestone 1 — Pure parsing correctness (fast, high leverage):**
P1 `SchemaParser`, P3 `OpenAPIValidator` (both **S**), then P2 `PathParser` (**M**). No mocks; locks the front-end that feeds all generation and pins the parser latent bugs.

**Milestone 2 — Generation correctness (flagship):**
P4 harness + Tier A/B compile-checks + generator behavioral tests, including the empty-`responses` negative control and the React-Query `args = {}` guard. Extend/replace `TypeAndSdkGenerator.test.ts`. Also P6 `FileWriter` extensions (cheap, sits alongside generation output).

**Milestone 3 — Orchestration:**
P5 `ExtensionController` — pins the adapter-reset bug and the resolve→generate data flow.

**Milestone 4 — Activation & UI glue:**
P7 `extension.ts`, then P8 `SidebarViewProvider` (host-side dispatch only; explicitly exclude inner webview JS).

**Milestone 5 — Type contracts:**
P9 `messages.test-d.ts` under the now-existing `test:types` script.

Order rationale: Milestones 0–2 deliver the most defect-catching value per hour (pure logic + the compile gate that guards the product's core promise). Orchestration and UI wiring follow because they depend on the shared vscode mock and surface fewer, lower-severity regressions. Type-level tests come last since they are worthless until the typecheck runner exists.

**Relevant paths (all new unless noted):**
`tests/parsers/SchemaParser.test.ts`, `tests/parsers/PathParser.test.ts`, `tests/parsers/OpenAPIValidator.test.ts`, `tests/generators/CompileCheck.test.ts`, `tests/generators/TypeGenerator.test.ts`, `tests/generators/SDKGenerator.test.ts`, `tests/generators/ReactQueryGenerator.test.ts`, `tests/generators/FileWriter.test.ts` (extend existing), `tests/ui/ExtensionController.test.ts`, `tests/ui/SidebarViewProvider.test.ts`, `tests/extension.test.ts`, `tests/ui/messages.test-d.ts`, `tests/helpers/vscodeMock.ts`, `tests/helpers/compileHarness.ts`, `tests/fixtures/`.