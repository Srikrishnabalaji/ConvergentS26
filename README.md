# Campus Building Room Finder

## Overview
- **Purpose:** Quickly locate campus buildings, view floor/room details, and see availability or schedules for rooms.
- **Platform:** Mobile-first app built with Expo (React Native + TypeScript).

## Quick Start (development)
Prerequisites:
- Node.js (>=16 recommended)
- `npm` or `yarn`
- Expo Go (on device) or iOS/Android simulator

1. Install dependencies

```bash
cd frontend
npm install
```

2. Start Metro and the Expo dev server using the Tunnel option

```bash
npx expo start --tunnel
```

Why `--tunnel`?
- The `--tunnel` option forces Expo to use a tunnel which works across different networks and avoids local network/firewall issues.  

1. Open on a device or simulator
- Scan the QR code in the Expo DevTools with Expo Go (iOS/Android) to open on a physical device.
- Press `i` in the terminal to open the iOS simulator, or `a` to open the Android emulator (if configured).