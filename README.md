# ⚡ Pulse

A fast, local-first desktop API client, scripting sandbox, and concurrent load testing studio built with **Go**, **Wails v2**, **React**, and **TypeScript**.

![Go](https://img.shields.io/badge/Go-1.26+-00ADD8?logo=go&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript&logoColor=white)
![Wails](https://img.shields.io/badge/Wails-v2-blueviolet)
![Local First](https://img.shields.io/badge/Storage-Local--First%20(~%2F.pulse)-emerald)

---

## Overview

Pulse runs natively on your desktop with a pure Go networking backend (`net/http` + `httptrace`) and an isolated JavaScript scripting engine (`goja`), storing all collections and environments as human-readable JSON files in `~/.pulse/`.

### Key Features

- **Multi-Protocol Request Composer**
  - **REST (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS`, `HEAD`)**: JSON, Form URL-encoded (`application/x-www-form-urlencoded`), Raw Text, and No Body.
  - **XML & SOAP (`1.1` / `1.2`)**: Built-in SOAP envelope templates, XML beautifier, and `SOAPAction` header helper.
  - **GraphQL**: Dedicated **Query** and **Variables (JSON)** sub-editors with formatting support.
- **Environment Variables Everywhere**
  - Switch between environments (`Dev`, `Staging`, `Prod`, or custom) from the header bar.
  - Reference `{{variable}}` and dynamic helpers (`{{$uuid}}`, `{{$guid}}`, `{{$timestamp}}`, `{{$isoTimestamp}}`, `{{$randomInt}}`) across:
    - Request URL bar (with live resolved URL preview)
    - Query Parameters & Request Headers (keys and values)
    - JSON, XML/SOAP, GraphQL, Form URL, and Raw request bodies
    - Pre-Request & Post-Response JavaScript scripts
    - Copy as `cURL` commands
    - Concurrent Load Testing
  - Smart autocomplete (`{{` or variable name prefix), syntax highlighting (green when set, amber when unset), and hover tooltips showing resolved values.
- **Syntax-Highlighted Code Editors & Response Inspector**
  - Line numbers, matching bracket highlighting, collapsible JSON/XML/GraphQL/JS blocks, and JSON validation/beautification (including template-aware validation for `{{vars}}`).
  - Interactive JSON Tree Viewer, raw/pretty response viewer, response headers, cookie jar viewer, and network timing waterfall (DNS, TCP connect, TLS handshake, TTFB, download).
- **Pre-Request & Post-Response Scripting Sandbox**
  - Powered by an embedded Goja JS runtime (`pkg/script/sandbox.go`) with zero external dependencies:
    - Read/write environment state: `pulse.getEnv(key)`, `pulse.setEnv(key, val)`, `pulse.environment.get/set`, `pulse.variables.get/set`, or inline `{{var}}` templates.
    - Response assertions: `pulse.test(name, fn)`, `pulse.expect(val).toBe(...)`, `.toBeGreaterThan(...)`, `.toContain(...)` with `response.status`, `response.statusText`, `response.body`, `response.size`, and `response.json()`.
- **Collections, Tabs & Import / Export**
  - File-backed collections and environments stored under `~/.pulse/collections/` and `~/.pulse/environments/` with debounced auto-save.
  - Inline rename for collection folders and requests (pencil icon or double-click), delete confirmations, search filtering, multi-tab workspace (`Close`, `Close Others`, `Close All`, `Copy cURL`).
  - **Import:** Collection JSON (v2.0 / v2.1), OpenAPI v2 (Swagger 2.0) & OpenAPI v3 (3.0 / 3.1 JSON/YAML) with automatic version detection, CSV endpoint sheets, and raw `cURL` commands.
  - **Export:** Collection JSON, OpenAPI v2 (Swagger 2.0) JSON, single request export, and Copy as `cURL`.
- **Integrated Concurrent Load Tester**
  - Configure Virtual Users (concurrent workers), Duration, and Ramp-Up time.
  - Real-time Wails event streaming (`loadtest:tick`) for RPS, success rate, total requests, status code breakdown, and sub-millisecond average latency.
  - Percentile metrics (`Min`, `Average`, `p50`, `p90`, `p95`, `p99`, `Max`) and one-click export to a standalone **HTML Load Test Report**.
- **UI & Ergonomics**
  - Dark & Light themes, Side-by-Side or Stacked split layouts, fullscreen shortcut (`F11` / `Cmd+Shift+F`), save shortcut (`Cmd/Ctrl+S`), and theme toggle (`Cmd/Ctrl+Shift+T`).

---

## Architecture

```text
+-------------------------------------------------------------------+
|                        Pulse Desktop App                          |
|                                                                   |
|  React + TypeScript UI          Wails v2 IPC         Go Core      |
|  - TopUrlBar & Tabs          <---------------->  - engine (HTTP)  |
|  - RequestComposer                               - resolver       |
|  - CodeInputEditor                               - script (goja)  |
|  - ResponseViewer                                - loadtest       |
|  - LoadTestPanel                                 - importer       |
|  - EnvironmentModal                              - exporter       |
|                                                  - storage        |
+-------------------------------------------------------------------+
```

---

## Project Structure

```text
pulse/
├── main.go                       # Wails application window setup & lifecycle
├── app.go                        # Go methods bound to the frontend via Wails IPC
├── version.go                    # Semantic application version (AppVersion)
├── wails.json                    # Wails build & bundle metadata
├── go.mod / go.sum               # Go module definition & dependencies
├── pkg/
│   ├── engine/                   # net/http + httptrace client, cookie jar, URL/header resolvers
│   ├── exporter/                 # OpenAPI v2 (Swagger 2.0) exporter
│   ├── importer/                 # Collection JSON, OpenAPI v2/v3 (JSON/YAML), CSV, and cURL parsers
│   ├── loadtest/                 # Concurrent worker runner, percentile metrics, HTML reporter
│   ├── resolver/                 # {{var}} & dynamic token ($uuid, $timestamp, etc.) resolver
│   ├── script/                   # Goja JS sandbox for pre-request & post-response scripts
│   └── storage/                  # Disk persistence under ~/.pulse/collections & environments
├── scripts/
│   ├── build-app.sh              # macOS .app bundle build with multi-res icon & ad-hoc codesign
│   └── bump-version.sh           # Syncs version across version.go, wails.json, package.json
└── frontend/
    └── src/
        ├── App.tsx               # Workspace state, tabs, auto-save, request lifecycle
        ├── types.ts              # Shared TypeScript interfaces
        ├── utils/
        │   ├── curlBuilder.ts    # cURL command generator with env var resolution
        │   └── envVars.ts        # Shared {{var}} autocomplete, trigger & JSON template helpers
        └── components/
            ├── Header.tsx
            ├── IconRail.tsx
            ├── Sidebar.tsx
            ├── TopUrlBar.tsx
            ├── RequestComposer.tsx
            ├── ResponseViewer.tsx
            ├── CodeInputEditor.tsx
            ├── CodeEditor.tsx
            ├── EnvVarInput.tsx
            ├── EnvVarOverlay.tsx
            ├── KeyValueTable.tsx
            ├── JSONTreeViewer.tsx
            ├── JSONViewer.tsx
            ├── EnvironmentModal.tsx
            ├── ImportModal.tsx
            └── loadtest/
                └── LoadTestPanel.tsx
```

---

## Getting Started (New Machine Setup)

### 1. System Prerequisites

#### macOS
1. **Install Xcode Command Line Tools:**
   ```bash
   xcode-select --install
   ```
2. **Install Go (`1.26+`) and Node.js (`18+`):**
   ```bash
   brew install go node
   ```
   Verify installed versions:
   ```bash
   go version
   node -v
   npm -v
   ```

#### Windows / Linux
- **Windows:** Install [Go 1.26+](https://go.dev/dl/), [Node.js 18+](https://nodejs.org/), and Microsoft WebView2 (pre-installed on Windows 10/11).
- **Linux (Debian/Ubuntu):** Install Go `1.26+`, Node.js `18+`, and Wails native dependencies (`libgtk-3-dev`, `libwebkit2gtk-4.1-dev` or `4.0-dev`, `build-essential`).

---

### 2. Install & Verify Wails CLI v2

1. **Install the Wails CLI:**
   ```bash
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```
2. **Add Go's `bin` directory to your `PATH`** (so `wails` can be run from anywhere):
   - **macOS / Linux (`~/.zshrc` or `~/.bashrc`):**
     ```bash
     echo 'export PATH="$PATH:$(go env GOPATH)/bin"' >> ~/.zshrc
     source ~/.zshrc
     ```
   - **Windows (PowerShell):** Ensure `%USERPROFILE%\go\bin` is included in your user `PATH` environment variable.
3. **Verify your local setup with `wails doctor`:**
   ```bash
   wails doctor
   ```
   Confirm the output ends with: `SUCCESS  Your system is ready for Wails development!`.

---

### 3. Clone & Install Project Dependencies

```bash
git clone <your-repo-url>
cd pulse

# Download Go module dependencies
go mod download

# Install frontend npm dependencies
cd frontend
npm install
cd ..
```

---

### 4. Run in Development Mode (Hot Reload)

```bash
wails dev
```

This launches the native desktop window with live Vite frontend hot reload and automatic Go backend recompilation.

---

### 5. Build Production Desktop App

- **macOS `.app` bundle with full multi-resolution icon & ad-hoc signature (recommended on macOS):**
  ```bash
  bash scripts/build-app.sh
  open build/bin/pulse.app
  ```
- **Standard Wails build (macOS / Windows / Linux):**
  ```bash
  wails build
  ```
  Output binary location:
  - macOS: `build/bin/pulse.app`
  - Windows: `build/bin/pulse.exe`
  - Linux: `build/bin/pulse`

### Bump Semantic Version

Update the version consistently across `version.go`, `wails.json`, and `frontend/package.json`:

```bash
./scripts/bump-version.sh patch   # or minor / major
```

---

## Testing & Verification

### Go Backend Tests

```bash
go test -v ./...
```

Covers HTTP variable resolution (`pkg/engine`), OpenAPI v2/v3 & Collection import (`pkg/importer`), OpenAPI v2 export (`pkg/exporter`), load test throughput/header/query accuracy (`pkg/loadtest`), Goja scripting sandbox (`pkg/script`), and collection storage/rename (`pkg/storage`).

### Frontend Typecheck & Build

```bash
cd frontend
npx tsc --noEmit
npm run build
```

---

## Local Data Storage

Pulse stores all workspace data locally on disk so collections can be backed up or versioned cleanly:

- `~/.pulse/collections/<CollectionName>/<requestId>.json`
- `~/.pulse/environments/<envId>.json`
