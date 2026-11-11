# 📊 Pulse - Project Progress & Roadmap Tracker

Last Updated: `2026-11-11`  
Current Status: **🎉 100% Completed — Production Ready!**

---

## 📈 Overall Progress Dashboard

```text
Progress: [████████████████████████] 100% Completed
```

| Phase | Milestone | Status | Completion | Notes |
| :--- | :--- | :---: | :---: | :--- |
| **Phase 1** | Project Setup & Wails Bootstrap | ✅ Completed | 100% | Wails v2 + React 19 + Tailwind CSS + Lucide |
| **Phase 2** | Core Go HTTP Engine | ✅ Completed | 100% | `net/http` + `httptrace` timing + `{{var}}` resolver |
| **Phase 3** | Request Composer & Response Viewer UI | ✅ Completed | 100% | 3-Pane UI, Key-Value tables, timing waterfall |
| **Phase 4** | File-Based Storage Engine (Disk JSON) | ✅ Completed | 100% | Collections & envs saved as files to `~/.pulse/` |
| **Phase 4.5**| Import Engine (Collection JSON, CSV & cURL) | ✅ Completed | 100% | Collection v2.0/v2.1, OpenAPI v2 JSON + CSV spreadsheet importer |
| **Phase 5** | Built-in Load Testing | ✅ Completed | 100% | Goroutine workers, live ticker, p50/p90/p95/p99, HTML reports |
| **Phase 6** | Cookie Jar & JavaScript Scripting | ✅ Completed | 100% | Cookie persistence + Goja JS sandbox + Test assertions |
| **Phase 7** | Multi-Protocol (GraphQL & cURL) | ✅ Completed | 100% | GraphQL dual editor + 1-click cURL importer |
| **Phase 8** | Standalone Packaging & Distribution | ✅ Completed | 100% | Compiled standalone macOS `.app` (~15 MB) |

---

## 🔍 Detailed Milestone Breakdown

### ✅ Phase 1: Foundation & Bootstrap
- [x] Install & verify Wails CLI (`v2.17.1`) and Go toolchain.
- [x] Initialize Wails project with React + TypeScript template.
- [x] Configure Tailwind CSS and Lucide icons.
- [x] Establish Go-to-Frontend IPC communication bridge.
- [x] Compile native test binary (`build/bin/pulse.app` - 9.0 MB).

### ✅ Phase 2: Core Go HTTP Engine (`pkg/`)
- [x] **Data Structures (`pkg/engine/models.go`):**
  - `HTTPRequest`, `HTTPResponse`, `HeaderPair`, `ParamPair`, `RequestBody`, `TimingStats`, `CookieItem`, `TestResult`.
- [x] **High-Performance Client (`pkg/engine/client.go`):**
  - Tuned `http.Transport` with persistent connection pooling (`MaxIdleConns: 500`).
  - Integrated `net/http/httptrace` to record DNS, TCP connect, TLS handshake, TTFB, and download duration.
  - Support for `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`.
- [x] **Variable Resolver (`pkg/resolver/template.go`):**
  - Recursive regex replacement of `{{variable}}` from active environment.
  - Built-in dynamic variables: `{{$uuid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`.

### ✅ Phase 3: Desktop UI Workspace (`frontend/src/`)
- [x] **Header Component (`Header.tsx`):**
  - Pulse branding & activity icon.
  - Inline request name editor.
  - Active environment dropdown (`Dev`, `Staging`, `Prod`).
  - Environment management modal toggle.
- [x] **Request Composer (`RequestComposer.tsx`):**
  - Method selector + URL input bar + Send button.
  - Keyboard shortcut: `Cmd+Enter` (or `Ctrl+Enter`) to send.
  - Synchronized Query Parameters table with real-time URL two-way binding.
  - Headers table with add/remove/toggle controls.
  - Request Body editor with format selector (`none`, `JSON`, `raw`, `x-www-form-urlencoded`, `graphql`).
- [x] **Response Inspector (`ResponseViewer.tsx`):**
  - Status code badge (`200 OK`, `404 Not Found`, `500 Server Error`).
  - Response duration in milliseconds and size in KB/MB.
  - One-click "Copy Response" with visual feedback.
  - Syntax-highlighted JSON viewer with automatic pretty-printing.
  - Response headers key-value table.
  - Visual Network Timing Breakdown card (DNS, TCP, TLS, TTFB, Total).
- [x] **Environment Manager (`EnvironmentModal.tsx`):**
  - Create, rename, delete environments.
  - Add/edit variable key-value pairs.
  - Switch active environment with one click.

### ✅ Phase 4: File-Based Storage Engine (`pkg/storage/`)
- [x] Implemented `pkg/storage/manager.go` managing disk persistence under `~/.pulse/`.
- [x] Hierarchical Collections & Folders tree in `Sidebar.tsx` with count badges.
- [x] "Save" button (`Cmd+S` / `Ctrl+S`) saving requests directly as formatted `.json` files.
- [x] Environments saved directly as individual JSON files in `~/.pulse/environments/`.
- [x] Zero database dependency—100% Git-trackable and human-readable on disk.

### ✅ Phase 4.5: Import Engine (`pkg/importer/`)
- [x] **Collection v2.0 / v2.1 & OpenAPI v2 Importer:**
  - Recursive folder traversal into nested collections.
  - Extracts Method, Raw URL, Query Params, Headers, and Request Body.
- [x] **CSV Spreadsheet Importer:**
  - Maps columns: `Name, Method, URL, Headers, Body`.
  - Batch generates request `.json` files into a target collection folder.
- [x] **Import UI Modal (`ImportModal.tsx`):**
  - File upload picker for `.json` and `.csv`.
  - Direct paste textareas for Collection JSON / OpenAPI v2, CSV, and cURL commands.

### ✅ Phase 5: Built-in Load Testing (`pkg/loadtest/`)
- [x] Implemented `pkg/loadtest/runner.go` using high-performance Go worker pool with connection pooling (`MaxIdleConns: 2000`).
- [x] Configurable parameters: Virtual Users (1 to 500), Duration (seconds), Ramp-up.
- [x] Real-time event streaming: Live RPS, error rate, and average latency updates every 250ms via `runtime.EventsEmit`.
- [x] Emergency Stop / Kill switch (`StopLoadTest()`).
- [x] **Percentile-based performance summary (`metrics.go`):**
  - Exact percentiles calculated: **p50 (Median), p90, p95 (SLA baseline), p99 (tail latency), Min, Max, Average**.
  - HTTP Status code distribution.
- [x] One-click standalone offline HTML dashboard report generator (`reporter.go`).
- [x] Dedicated UI **"Load Test"** tab in Request Composer (`LoadTestPanel.tsx`).

### ✅ Phase 6: Cookie Jar & Scripting Sandbox (`pkg/script/`, `pkg/engine/cookies.go`)
- [x] Implemented thread-safe `CookieManager` (`net/http/cookiejar`) for automatic domain cookie persistence.
- [x] Embedded **Goja pure Go JavaScript engine** (`pkg/script/sandbox.go`).
- [x] **Pre-Request Script execution:** Allows setting dynamic variables before sending (`pulse.setEnv(...)`).
- [x] **Post-Response Script execution:**
  - Exposes `response.status`, `response.body`, `response.json()`.
  - Built-in test assertions: `pulse.test('name', () => expect(a).toBe(b))`.
  - Automatic environment variable extraction and chaining.
- [x] UI **"Scripts"** tab in Request Composer with quick snippet buttons (`Status 200`, `Set Env Var`).
- [x] UI **"Tests"** tab in Response Viewer displaying pass/fail badges.
- [x] UI **"Cookies"** tab in Response Viewer displaying session cookies.

### ✅ Phase 7: Multi-Protocol (GraphQL & cURL) (`pkg/importer/curl.go`)
- [x] **Dedicated GraphQL Editor:**
  - Dual-pane GraphQL Query and Variables JSON editor.
  - Automatically compiles into HTTP POST with `{ "query": "...", "variables": { ... } }`.
- [x] **cURL Command Parser & Importer:**
  - Parses `-X / --request`, `-H / --header`, `-d / --data / --data-raw`, and URLs.
  - Quick-import drawer right from the top URL bar (`Terminal` icon).
  - Also supported directly in `ImportModal.tsx`.

### ✅ Phase 8: Production Packaging & Modern UI Redesign
- [x] Built standalone native macOS app (`build/bin/pulse.app` - 15 MB).
- [x] App configured to launch directly in **Fullscreen mode** (`WindowStartState: options.Fullscreen`).
- [x] Added fullscreen toggle button in Header + global keyboard shortcuts (`F11`, `Cmd+Shift+F`, `Cmd+S`).
- [x] Fixed request creation to immediately persist new requests independently without overwriting existing requests.
- [x] **Leftmost Icon Rail (`IconRail.tsx`)**:
  - Vertical rail with circular brand ring logo, Home, Rocket (Load Testing), Workspace letter chips (`PL`, `AP`), `+` button, and `⚙ Preferences`.
- [x] **Code Editor with Code Folding & `{ ⤹ N }` Pills (`CodeEditor.tsx`)**:
  - Line numbers gutter with interactive fold carets (`▾` and `▸`).
  - When folded, compresses into `{ ⤹ N },` pills with line count indicators.
  - Expand All and Collapse All master controls.
  - Modern syntax highlighting: Cyan keys, Mint strings, Golden Amber numbers, Magenta booleans.
- [x] **JSONPath Live Query Filter Bar**:
  - Bottom bar in Response Viewer supporting real-time JSON filtering (`$.store.books[*].author`).
- [x] **Beautify JSON**:
  - Bottom-left action button in Request Composer for instant formatting.
- [x] **Signature HTTP Method Badges & Action Buttons**:
  - GET Mint (`#10b981`), POST Violet (`#8b5cf6`), PUT Amber (`#f59e0b`), PATCH Cyan (`#06b6d4`), DEL Rose (`#f43f5e`).
  - Solid purple/violet `Send ▾` button with gradient glow.
- [x] **Direct 1-Click Theme Switcher & Keyboard Shortcut**:
  - Added dedicated 1-click **Dark 🌙 / Light ☀️** toggle button in the header bar.
  - Added global keyboard shortcut **`Cmd+Shift+T`** (or `Ctrl+Shift+T`) to switch themes instantly anywhere in the app.
  - Separate Palette popover for choosing among the 6 vibrant accent colors.
- [x] Zero external runtime dependencies (no Docker, no database, no Node.js needed for end-users).
- [x] Cross-platform build target ready for Windows (`pulse.exe`) via `wails build -platform windows/amd64`.

---

## 📁 Source File Inventory

```text
pulse/
├── README.md                          # Project documentation & quick start guide
├── PROGRESS.md                        # This tracker document (100% Complete)
├── app.go                             # Go-to-Wails IPC bridge methods
├── main.go                            # Desktop window setup & application entry
├── go.mod / go.sum                    # Go dependencies & toolchain definitions
├── wails.json                         # Wails build configuration
├── build/bin/pulse.app                # Standalone native compiled application
├── pkg/
│   ├── engine/
│   │   ├── models.go                  # HTTP request/response/timing/cookie structs
│   │   ├── client.go                  # High-performance net/http client with httptrace
│   │   └── cookies.go                 # Thread-safe cookiejar session manager
│   ├── loadtest/
│   │   ├── models.go                  # Load test config & summary structs
│   │   ├── runner.go                  # Goroutine worker pool with live 250ms ticks
│   │   ├── metrics.go                 # Percentile calculator (p50, p90, p95, p99)
│   │   └── reporter.go                # Standalone offline HTML report generator
│   ├── storage/
│   │   ├── models.go                  # SavedRequest, Collection, Environment structs
│   │   └── manager.go                 # File-based JSON disk persistence (~/.pulse/)
│   ├── importer/
│   │   ├── importer.go                # Collection JSON / OpenAPI v2 & CSV parser
│   │   └── curl.go                    # cURL command string tokenizer & parser
│   ├── script/
│   │   └── sandbox.go                 # Goja embedded JS runtime for pre/post scripts
│   └── resolver/
│       └── template.go                # Dynamic {{var}} template substitution engine
└── frontend/
    ├── package.json                   # React, Tailwind, Lucide dependencies
    ├── vite.config.ts                 # Vite bundler configuration
    └── src/
        ├── App.tsx                    # Main 3-pane layout & state coordination
        ├── types.ts                   # TypeScript interfaces & types
        ├── style.css                  # Tailwind CSS styling & dark mode rules
        └── components/
            ├── Header.tsx             # Top bar, request title, environment selector
            ├── Sidebar.tsx            # Left navigation for collections, requests & import
            ├── RequestComposer.tsx    # Composer with Params, Headers, Body, Scripts, Load Test
            ├── ResponseViewer.tsx     # Status, latency, pretty JSON, cookies, tests, waterfall
            ├── KeyValueTable.tsx      # Dynamic key-value row editor
            ├── EnvironmentModal.tsx   # Environment & variable configuration modal
            ├── ImportModal.tsx        # Collection JSON, CSV & cURL import modal
            └── loadtest/
                └── LoadTestPanel.tsx  # Load testing console & percentiles table
```
