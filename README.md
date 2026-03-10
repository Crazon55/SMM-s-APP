# Device Orchestration System (DOS) V1

Internal LAN system for device behavior orchestration with anti-symmetry and audit logging.

## Components

- **Server** (`server/`) – Central orchestrator: plan generation, device auth, logging, admin API
- **Admin UI** (`admin-ui/`) – Web UI for devices, today view, logs, settings
- **Android App** (`android-app/`) – Device app for operators: plan view, session/post logging, sync

## Quick Start

### Server (Office PC)

```bash
cd server
npm install
npm run dev
```

Server runs at `http://localhost:3000`. Admin UI at `http://localhost:3000` (served by same server).

### Android App

Open `android-app/` in Android Studio, build APK, install on device. Configure server URL (default: same LAN IP as office PC).

## Non-goals (V1)

- No Instagram API, no automation, no credential storage in app
- No growth analytics or micro-action logging

## License

Internal use only.
