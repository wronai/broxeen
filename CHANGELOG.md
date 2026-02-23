## [1.0.44] - 2026-02-23

### Summary

feat(docs): deep code analysis engine with 6 supporting modules

### Docs

- docs: update README
- docs: update TODO.md

### Other

- update img_1.png
- update src-tauri/src/audio_commands.rs
- update src-tauri/src/stt.rs
- update src/components/Chat.tsx
- update src/hooks/useSpeech.test.ts
- update src/hooks/useSpeech.ts
- update src/hooks/useStt.ts
- update src/hooks/useTts.ts
- update src/integration/autoWatchIntegration.ts
- update src/plugins/discovery/advancedPortScanPlugin.ts
- ... and 6 more


## [1.0.44] - 2026-02-23

### Summary

feat(ux): context-aware quick-action buttons on assistant messages + interactive welcome screen

### Features

- **MessageQuickActions** (`src/components/MessageQuickActions.tsx`): renders contextual action buttons at the bottom of each assistant message
- **quickActionResolver** (`src/utils/quickActionResolver.ts`): analyzes message content (IPs, URLs, keywords) and generates up to 5 relevant follow-up actions
  - Network scan → ping, port scan, rescan
  - Camera detected → live preview, snapshot, monitor
  - Ping result → port scan, SSH
  - Port scan → SSH (port 22), browse (port 80/443), monitor
  - Browse result → refresh, search more
  - SSH result → disk usage, processes
  - Monitor → logs, active list
  - Help → scan, cameras, browse, config
- **Interactive welcome screen**: 6 clickable action cards (scan network, find cameras, browse, config, monitor, help) replacing the old text-only welcome
- Three action modes: **execute** (instant), **prefill** (fills input), **link** (opens URL)
- Executed actions get a ✓ checkmark and become disabled

### Fixes

- `CAMERA_KEYWORDS` regex now matches Polish `kamer` without suffix (all declensions)
- IP extraction filters out `.0` and `.255` broadcast/network addresses

### Tests

- 19 new tests for `quickActionResolver` covering all action categories, deduplication, and limits
- Total: **614 tests across 41 files**, all passing

### Other

- Updated TODO.md with completed interaction items and new future tasks


## [1.0.43] - 2026-02-23

### Summary

feat(None): configuration management system

### Other

- update src-tauri/src/network_scan.rs
- update src/components/MessageQuickActions.tsx
- update src/utils/quickActionResolver.ts


## [1.0.42] - 2026-02-23

### Summary

feat(docs): deep code analysis engine with 4 supporting modules

### Docs

- docs: update README
- docs: update TODO.md

### Other

- update src-tauri/src/main.rs
- update src-tauri/src/network_scan.rs
- update src/components/CameraLiveInline.tsx


## [1.0.41] - 2026-02-23

### Summary

fix(src-tauri): RTSP live worker metadata + clean build

### Fixes

- rtsp: include `frame_age_ms` and `frame_count` metadata in `rtsp_capture_frame` results
- rtsp: increment frame counter in RTSP worker cache
- build: remove unused field in RTSP worker to eliminate Rust warning

### Other

- update src-tauri/src/network_scan.rs


## [1.0.40] - 2026-02-23

### Summary

feat(camera/live): better live UX + cached RTSP worker

### Fixes

- rtsp: `rtsp_capture_frame` now uses a long-lived ffmpeg worker (per camera/url) and returns cached JPEG quickly
- ui: full-screen `camera_live` overlay can start from an initial preview frame
- camera: prefer last known working RTSP URL from config when user pasted a full RTSP URL previously
- types: remove `any` around `camera_live` payload (`initialBase64`/`initialMimeType`)

### Docs

- docs: update TODO.md

### Other

- update src-tauri/src/network_scan.rs
- update src/components/Chat.tsx
- update src/components/HealthDiagnostic.tsx
- update src/domain/chatEvents.ts
- update src/plugins/camera/cameraLivePlugin.ts


## [1.0.39] - 2026-02-23

### Summary

fix(camera/live): RTSP compatibility + SQLite migrations reliability

### Fixes

- camera: `rtsp_capture_frame` is now invoked with both `cameraId` and `camera_id` (frontend call-sites) to remain compatible with Tauri command arg naming
- camera: `rtsp_capture_frame` Rust command uses `camera_id` parameter name (kept reserved for future per-camera tagging)
- db: migrations run deterministically (migration SQL executed sequentially and awaited)
- db: `db_execute` supports multi-statement SQL via `execute_batch` when params are empty
- rtsp: ffmpeg runner retries without timeout flags when the local ffmpeg build doesn't support them
- ui: `camera_live` blocks can include an initial preview frame and open a full-screen live overlay in Tauri

### Docs

- docs: update README
- docs: update TODO.md

### Other

- update src-tauri/src/network_scan.rs
- update src/App.tsx
- update src/components/CameraLiveInline.tsx
- update src/components/Chat.tsx
- update src/components/HealthDiagnostic.tsx
- update src/utils/healthCheck.ts


## [1.0.38] - 2026-02-23

### Summary

feat(build): deep code analysis engine with 5 supporting modules

### Fixes

- dev: `tauri dev` uruchamia teraz Vite automatycznie (Tauri `beforeDevCommand`/`beforeBuildCommand`, użycie `corepack`)
- dev: `make dev` / `make dev-nvidia` czyści procesy i port `5173` przed startem, aby uniknąć błędu "Port 5173 is already in use"
- chat: komenda `pokaż live <ip>` renderuje tylko jeden wynik live (blok `camera_live`), bez dodatkowych wiadomości preview/diag
- ui: pełnoekranowy podgląd live (ESC aby zamknąć) dla `camera_live` w Tauri

### Other

- build: update Makefile
- update src/App.tsx
- update src/components/Chat.tsx
- ui: move/compact debug + diagnostic buttons (Błędy/Kopiuj błędy/Diagnostyka) to top-right, above scope, in one line
- update src/contexts/pluginContext.tsx
- update src/hooks/useDatabaseManager.ts
- update src/hooks/useHistoryPersistence.ts
- update src/integration/autoWatchIntegration.ts
- update src/plugins/discovery/advancedPortScanPlugin.ts
- update src/plugins/discovery/networkScanPlugin.ts
- update src/plugins/monitor/monitorPlugin.ts


## [1.0.37] - 2026-02-23

### Summary

feat(build): configuration management system

### Other

- update .gitignore
- build: update Makefile
- update scripts/add-camera.sql
- update src/components/CameraLiveInline.tsx
- update src/components/Chat.tsx
- update src/core/bootstrap.ts
- update src/core/types.ts
- update src/domain/chatEvents.ts
- update src/plugins/camera/cameraLivePlugin.ts
- update src/plugins/http/browsePlugin.test.ts


## [1.0.36] - 2026-02-22

### Summary

feat(tests): deep code analysis engine with 4 supporting modules

### Docs

- docs: update ADVANCED_CAMERA_DETECTION.md
- docs: update INLINE_ACTION_HINTS_CAMERA.md

### Other

- update src/App.tsx
- update src/contexts/pluginContext.tsx
- update src/core/intentRouter.test.ts
- update src/core/intentRouter.ts
- update src/plugins/__tests__/plugins.e2e.test.ts
- update src/plugins/discovery/advancedPortScanPlugin.ts
- update src/plugins/discovery/networkScanPlugin.ts
- update src/plugins/http/browsePlugin.ts
- update src/plugins/network/portScanPlugin.test.ts
- update src/plugins/network/portScanPlugin.ts
- ... and 1 more


## [2.1.0] - 2026-02-22

### Summary

feat(monitor): Chat-based monitoring system with VPN/Tor scopes

### New — MonitorPlugin (`src/plugins/monitor/`)

- **Chat-based monitoring** — `monitoruj kamerę wejściową`, `obserwuj 192.168.1.100 co 30s`
- **Stop/List/Logs** — `stop monitoring kamery`, `aktywne monitoringi`, `pokaż logi`
- **Chat-based config** — `ustaw próg zmian 20%`, `ustaw interwał 60s` (no config files)
- **Auto-polling** — periodic checks with configurable interval and change threshold
- **Change detection** — Jaccard-based diff scoring with alert on threshold breach
- **Monitoring logs** — full history of checks, changes, errors accessible in chat context

### New Scopes

- **VPN** — full LAN + internet access through VPN tunnel, all plugins including monitor
- **Tor** — anonymous browsing through Tor network (.onion), internet-only + monitor
- Total: **6 scopes** (local, network, internet, vpn, tor, remote)

### Tests

- `monitor.test.ts` — 15 tests: start/stop/list/logs, chat config, polling, VPN/Tor scope validation


## [2.0.0] - 2026-02-22

### Summary

feat(plugins): Full plugin system with scoped architecture, camera controls, marketplace, and E2E tests

### New Plugins — Local Network (`src/plugins/local-network/`)

- **PingPlugin** — ICMP ping / HTTP HEAD fallback for host reachability
- **PortScanPlugin** — TCP port scanning with common service identification
- **ArpPlugin** — ARP table discovery with MAC vendor lookup
- **WakeOnLanPlugin** — Wake-on-LAN magic packet sending
- **MdnsPlugin** — mDNS/Bonjour/Avahi service discovery
- **OnvifPlugin** — ONVIF WS-Discovery camera detection with profiles

### New Plugins — Cameras (`src/plugins/cameras/`)

- **CameraHealthPlugin** — Camera online/offline status, uptime, resolution, FPS
- **CameraPtzPlugin** — Pan/Tilt/Zoom control (left/right/up/down/zoom/preset)
- **CameraSnapshotPlugin** — Single-frame capture from cameras

### New Plugins — Marketplace (`src/plugins/marketplace/`)

- **MarketplacePlugin** — Browse, search, install, uninstall community plugins
- Demo catalog with 6 community plugins (UPnP, Bandwidth, DNS, Geolocation, Timelapse, SNMP)

### Plugin System Improvements

- **Scoped plugin folders** — `local-network/`, `cameras/`, `marketplace/` with barrel exports
- **ScopeRegistry** — Updated with all new plugin IDs per scope (local, network, internet, remote)
- **IntentRouter** — 13 new intent patterns (ping, port-scan, arp, wol, mdns, onvif, camera:health, camera:ptz, camera:snapshot, marketplace) with entity extraction
- **Bootstrap** — Auto-registers all new plugins with try/catch resilience

### Tests

- **Unit tests** — `localNetwork.test.ts` (6 plugins × 4-6 tests), `cameras.test.ts` (3 plugins × 5-6 tests), `marketplace.test.ts` (install/uninstall/search/browse)
- **IntentRouter tests** — 10 new test cases for all new intents + scope-aware routing
- **E2E tests** — `plugin-system.spec.ts` with full flows: network scanning, camera discovery → health → snapshot, PTZ control, marketplace browse → install → uninstall

### Docs

- Updated CHANGELOG, TODO, usage examples


## [1.0.35] - 2026-02-22

### Summary

fix(None): CLI interface with 2 supporting modules

### Other

- update src/App.tsx
- update src/contexts/pluginContext.tsx
- update src/core/plugin.types.ts
- update src/plugins/chat/chatPlugin.ts
- update src/plugins/discovery/networkScanPlugin.ts
- update src/plugins/discovery/serviceProbePlugin.ts
- update src/plugins/http/browsePlugin.ts
- update src/utils/errorReporting.ts


## [1.0.34] - 2026-02-22

### Summary

fix(tests): CLI interface with 2 supporting modules

### Other

- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/core/plugin.types.ts
- update src/plugins/chat/chatPlugin.ts
- update src/utils/errorReporting.ts


## [1.0.33] - 2026-02-22

### Summary

feat(None): core module improvements

### Other

- update src/App.tsx
- update src/components/Chat.tsx


## [1.0.32] - 2026-02-22

### Summary

fix(None): configuration management system

### Other

- update src/App.tsx
- update src/components/ErrorReportPanel.tsx
- update src/utils/errorReporting.ts


## [1.0.31] - 2026-02-22

### Summary

fix(tests): CLI interface with 2 supporting modules

### Other

- update src/components/HealthDiagnostic.test.tsx
- update src/components/HealthDiagnostic.tsx
- update src/contexts/pluginContext.tsx
- update src/core/pluginRegistry.ts
- update src/core/types.ts
- update src/plugins/rtsp-camera/rtspCameraPlugin.ts
- update src/utils/healthCheck.ts


## [1.0.30] - 2026-02-22

### Summary

fix(build): code quality metrics with 5 supporting modules

### Build

- deps: update package.json

### Other

- build: update Makefile
- update src/App.tsx
- update src/components/HealthDiagnostic.tsx
- update src/core/pluginRegistry.ts
- update src/core/types.ts
- update src/utils/healthCheck.test.ts
- update src/utils/healthCheck.ts
- update vite.config.ts


## [1.0.29] - 2026-02-22

### Summary

feat(tests): code relationship mapping

### Other

- update src/components/Chat.tsx
- update src/plugins/http/browsePlugin.test.ts


## [1.0.28] - 2026-02-22

### Summary

feat(None): deep code analysis engine

### Other

- update src/components/CameraPreview.tsx
- update src/components/Chat.tsx
- update src/domain/chatEvents.ts
- update src/integration/autoWatchIntegration.ts
- update src/persistence/databaseManager.ts
- update src/plugins/http/browsePlugin.ts


## [1.0.27] - 2026-02-22

### Summary

refactor(tests): deep code analysis engine with 4 supporting modules

### Test

- update test-results/.last-run.json
- docs: update error-context.md
- docs: update error-context.md

### Other

- update e2e/network-scanning-flow.spec.ts
- update src/components/CameraPreview.tsx
- update src/components/Chat.tsx
- update src/domain/chatEvents.ts
- update src/hooks/useWatchNotifications.ts
- update src/integration/autoWatchIntegration.ts
- update src/persistence/databaseManager.ts
- update src/reactive/changeDetector.ts


## [1.0.26] - 2026-02-22

### Summary

refactor(tests): configuration management system

### Docs

- docs: update TODO.md

### Test

- update test-results/.last-run.json
- docs: update error-context.md

### Other

- update e2e/network-scanning-flow.spec.ts
- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update "test-results/network-scanning-flow-Netw-ba7a2-camera-list-\342\206\222-video-preview-chromium/error-context.md"
- update vite.config.ts


## [1.0.25] - 2026-02-22

### Summary

refactor(tests): configuration management system

### Other

- update e2e/network-scanning-flow.spec.ts
- update src/components/CameraPreview.tsx
- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/components/CommandHistory.tsx
- update src/components/QuickCommandHistory.tsx


## [1.0.24] - 2026-02-22

### Summary

feat(tests): core module improvements

### Other

- update src/core/bootstrap.ts
- update src/plugins/http/browsePlugin.test.ts
- update src/plugins/http/browsePlugin.ts


## [1.0.23] - 2026-02-22

### Summary

feat(None): deep code analysis engine with 3 supporting modules

### Build

- deps: update package.json

### Other

- update src/components/Chat.tsx
- update src/components/QuickCommandHistory.tsx
- update src/core/bootstrap.ts
- update src/core/types.ts
- update src/domain/chatEvents.ts


## [1.0.22] - 2026-02-22

### Summary

refactor(None): configuration management system

### Other

- update src/components/Chat.tsx
- update src/components/CommandHistory.tsx
- update src/components/NetworkHistorySelector.tsx
- update src/components/NetworkSelector.tsx
- update src/components/QuickCommandHistory.tsx
- update src/core/bootstrap.ts


## [1.0.21] - 2026-02-22

### Summary

feat(tests): update project

### Test

- update test_intent_routing.js
- update test_network_scan.js

### Other

- update src/components/Chat.tsx
- update src/components/NetworkSelector.tsx
- update src/core/bootstrap.ts


## [1.0.20] - 2026-02-22

### Summary

feat(tests): configuration management system

### Docs

- docs: update CAMERA_DISCOVERY_GUIDE.md

### Test

- update test_intent_routing.js
- update test_network_scan.js

### Build

- deps: update package.json

### Other

- update project.functions.toon
- update src/components/Chat.tsx
- update src/components/WatchBadge.simple.tsx
- update src/components/WatchBadge.tsx
- update src/core/intentRouter.ts
- update src/hooks/useWatchNotifications.ts
- update src/persistence/databaseManager.ts


## [1.0.19] - 2026-02-22

### Summary

refactor(tests): configuration management system

### Docs

- docs: update TODO.md

### Config

- config: update goal.yaml

### Other

- update src/App.tsx
- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/contexts/PluginContext.tsx
- update src/contexts/pluginContext.tsx
- update src/core/bootstrap.ts
- update src/core/commandBus.test.ts
- update src/core/commandBus.ts
- update src/core/intentRouter.test.ts
- update src/core/intentRouter.ts
- ... and 6 more


## [1.0.18] - 2026-02-22

### Summary

feat(tests): deep code analysis engine with 7 supporting modules

### Docs

- docs: update TODO.md
- docs: update mobile-development-suggestions.md

### Other

- update project.functions.toon
- scripts: update project.sh
- update src/components/Settings.test.tsx
- update src/contexts/PluginContext.tsx
- update src/core/bootstrap.ts
- update src/core/commandBus.test.ts
- update src/core/commandBus.ts
- update src/core/intentRouter.test.ts
- update src/core/intentRouter.ts
- update src/core/plugin.types.ts
- ... and 11 more


## [1.0.17] - 2026-02-22

### Summary

feat(docs): new API capabilities

### Docs

- docs: update README

### Other

- update img.png


## [1.0.16] - 2026-02-22

### Summary

refactor(tests): CLI interface improvements

### Other

- update e2e/chat-features.spec.ts
- update src-tauri/src/audio_commands.rs
- update src-tauri/src/browse_rendered.rs
- update src-tauri/src/content_cleaning.rs
- update src-tauri/src/content_extraction.rs
- update src-tauri/src/logging.rs
- update src-tauri/src/main.rs
- update src-tauri/src/settings.rs
- update src-tauri/src/tts_backend.rs
- update src/App.tsx
- ... and 41 more


## [1.0.15] - 2026-02-22

### Summary

feat(tests): CLI interface improvements

### Other

- update src-tauri/src/audio_commands.rs
- update src-tauri/src/browse_rendered.rs
- update src-tauri/src/main.rs
- update src-tauri/src/tts_backend.rs
- update src/components/Settings.tsx
- update src/hooks/useStt.ts
- update src/lib/browseGateway.test.ts
- update src/lib/browseGateway.ts
- update src/lib/llmClient.ts


## [1.0.14] - 2026-02-21

### Summary

feat(src-tauri): CLI interface with 2 supporting modules

### Other

- update src-tauri/src/audio_commands.rs
- update src-tauri/src/tts_backend.rs


## [1.0.13] - 2026-02-21

### Summary

feat(tests): CLI interface improvements

### Other

- update src-tauri/src/main.rs
- update src/components/Chat.test.tsx
- update src/components/Settings.tsx
- update src/domain/audioSettings.ts
- update src/lib/sttClient.ts


## [1.0.12] - 2026-02-21

### Summary

refactor(tests): CLI interface improvements

### Test

- update test-results/.last-run.json

### Other

- update src-tauri/src/main.rs
- update src-tauri/src/stt.rs
- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/hooks/useLlm.ts
- update src/hooks/useStt.ts
- update src/lib/browseGateway.test.ts
- update src/lib/browseGateway.ts
- update src/lib/sttClient.ts


## [1.0.11] - 2026-02-21

### Summary

fix(goal): CLI interface improvements

### Docs

- docs: update plan-llm-broxeen.md

### Other

- update .env.example
- update TODO/.env.example
- update TODO/llm.rs
- update TODO/llmClient.test.ts
- update TODO/llmClient.ts
- update TODO/llmPrompts.ts
- update TODO/useLlm.ts
- update project.functions.toon
- update project.toon
- update src-tauri/src/llm.rs
- ... and 7 more


## [1.0.10] - 2026-02-21

### Summary

feat(tests): CLI interface with 2 supporting modules

### Other

- update project.functions.toon
- update project.toon
- update project.toon-schema.json
- update src/App.tsx
- update src/components/Settings.test.tsx
- update src/hooks/useSpeech.ts
- update src/lib/browseGateway.test.ts
- update src/lib/browseGateway.ts


## [1.0.9] - 2026-02-21

### Summary

feat(tests): multi-language support with 3 supporting modules

### Other

- update src-tauri/src/main.rs
- update src/hooks/useTts.ts
- update src/lib/browseGateway.test.ts
- update src/lib/browseGateway.ts


## [1.0.8] - 2026-02-21

### Summary

feat(tests): configuration management system

### Other

- update src/components/Chat.test.tsx
- update src/domain/audioSettings.test.ts
- update src/domain/chatEvents.test.ts
- update src/lib/browseGateway.test.ts
- update src/lib/logger.ts
- update src/main.tsx
- update src/vite-env.d.ts


## [1.0.7] - 2026-02-21

### Summary

feat(tests): configuration management system

### Other

- update src/App.tsx
- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/components/Settings.tsx
- update src/domain/audioSettings.ts
- update src/domain/chatEvents.ts
- update src/lib/browseGateway.ts
- update src/lib/runtime.ts


## [1.0.6] - 2026-02-21

### Summary

feat(None): core module improvements

### Other

- update src/App.tsx
- update src/components/Chat.tsx
- update src/components/Settings.tsx
- update src/components/TtsControls.tsx
- update src/lib/phonetic.ts
- update src/lib/resolver.ts


## [1.0.5] - 2026-02-21

### Summary

feat(build): deep code analysis engine with 6 supporting modules

### Other

- build: update Makefile
- update src-tauri/tauri.conf.json
- update src/App.tsx
- update src/components/Chat.tsx
- update src/hooks/useSpeech.ts
- update src/hooks/useTts.ts
- update src/lib/logger.ts
- update src/main.tsx


## [1.0.4] - 2026-02-21

### Summary

feat(tests): configuration management system

### Docs

- docs: update README

### Build

- deps: update package.json

### Other

- update src/components/Chat.test.tsx
- update src/components/Chat.tsx
- update src/components/Settings.test.tsx
- update src/components/TtsControls.test.tsx
- update src/hooks/useSpeech.test.ts
- update src/hooks/useTts.test.ts
- update src/lib/phonetic.test.ts
- update src/lib/resolver.test.ts
- update src/lib/resolver.ts
- update src/test/setup.ts
- ... and 3 more


## [1.0.3] - 2026-02-21

### Summary

feat(src-tauri): configuration management system

### Other

- update .gitignore
- update src-tauri/Cargo.lock
- update src-tauri/Cargo.toml
- update src-tauri/capabilities/default.json
- update src-tauri/gen/schemas/acl-manifests.json
- update src-tauri/gen/schemas/capabilities.json
- update src-tauri/gen/schemas/desktop-schema.json
- update src-tauri/gen/schemas/linux-schema.json
- update src-tauri/icons/128x128.png
- update src-tauri/icons/128x128@2x.png
- ... and 5 more


## [1.0.2] - 2026-02-21

### Summary

refactor(config): configuration management system

### Docs

- docs: update README

### Test

- update test/broxeen.test.js

### Build

- deps: update package.json

### Config

- config: update goal.yaml

### Other

- update .gitignore
- build: update Makefile
- update index.html
- update postcss.config.js
- update src-tauri/Cargo.lock
- update src-tauri/Cargo.toml
- update src-tauri/build.rs
- update src-tauri/capabilities/default.json
- update src-tauri/icons/.gitkeep
- update src-tauri/src/main.rs
- ... and 15 more


## [1.0.1] - 2026-02-21

### Summary

refactor(docs): deep code analysis engine with 7 supporting modules

### Docs

- docs: update README

### Test

- update test_phonetic.py

### Config

- config: update goal.yaml

### Other

- update .idea/.gitignore
- build: update Makefile
- update phonetic.py
- update resolver.py


