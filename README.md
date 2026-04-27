<div align="center">

# WavePoint

**Indoor campus navigation for College Campuses** — search for a room, get a wall-respecting corridor path overlaid on the floor plan, and walk there with real-time step tracking.

*Built by the Convergent BT Spring 2026 team.*

[![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-1B1F23?style=for-the-badge&logo=expo&logoColor=white)](https://expo.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)](https://supabase.com/)
[![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)

</div>

---

## ✨ Features

- 🧭 **Indoor Pathfinding** — A* on rasterized occupancy grids produces corridor-accurate routes across 7 floors of the Gates Dell Complex (GDC). Distance-transform weighting keeps paths centered in hallways instead of hugging walls.
- 🏢 **Multi-Floor Navigation** — Routes seamlessly cross floors via elevators and stairwells, with step-by-step instructions and automatic floor switching.
- 👣 **Real-Time Step Tracking** — Pedometer-based dead reckoning moves a live position dot along the computed path as you walk. Includes a simulation mode for testing without physical movement.
- 🗺️ **Outdoor Routing** — MapLibre-powered campus map with OSRM pedestrian directions to any building entrance.
- 📅 **Calendar Integration** — Tap a class or event and navigate directly to the room.
- 👥 **Friend Groups & Location Sharing** — Create groups, share calendars, and see where friends are on campus.

---

## 🧠 How the Pathfinding Works

### 1. Grid Generation
> `backend/export_grids.py`

Each floor of the building PDF is rasterized at **2 px/pt** using PyMuPDF, thresholded into a binary wall mask, and processed with OpenCV morphological operations to seal hairline cracks while preserving doorways. Connected components analysis (seeded by known room positions) isolates the corridor network from room interiors. A Euclidean distance transform is computed so every passable pixel knows its distance to the nearest wall.

### 2. Runtime A*
> `frontend/lib/services/grid-astar.ts`

Given start and end coordinates, the app snaps them to the nearest passable pixel and runs **4-connected A\*** on the occupancy grid. Edge costs are weighted by the distance transform:

```
cost = 1 + 8 / (dist + 1)
```

…so the algorithm naturally prefers corridor centerlines. A Bresenham line-of-sight pass simplifies the raw pixel path into a minimal set of waypoints.

### 3. Graph Routing
> `frontend/lib/services/indoor-navigation.ts`

A higher-level graph of rooms, hallways, elevators, and stairwells handles multi-floor routing:

- **Graph-level A\*** finds the node sequence
- **`buildRoute`** splits it into per-floor segments
- **`computeGridRoute`** replaces each segment's waypoints with the wall-respecting grid path

---

## 🛠️ Tech Stack

| Layer | Technology |
| :--- | :--- |
| **Mobile App** | React Native, Expo, TypeScript, NativeWind |
| **Routing** | Expo Router (file-based) |
| **Backend** | Supabase (PostgreSQL, Auth, Storage, RLS) |
| **Maps** | MapLibre, Nominatim geocoding, OSRM pedestrian routing |
| **CV / Pathfinding** | Python, PyMuPDF, OpenCV, NumPy |
| **Sensors** | `expo-sensors` (Pedometer) |
| **Notifications** | Expo Notifications |

---

## 📁 Project Structure

```
frontend/
├── app/
│   ├── (tabs)/              # Main screens — Groups, Friends, Map, Calendar, Settings
│   └── (auth)/              # Login / authentication
├── components/
│   ├── map/                 # IndoorMapView, CampusMapLayer, SVGFloorPlan
│   └── ui/                  # Shared UI primitives (Button, Card, Avatar, etc.)
├── lib/
│   └── services/            # Core logic — indoor-navigation, grid-astar, routing, geocoding
└── assets/
    ├── grids/               # Pre-computed occupancy grids (one JSON per floor)
    └── floorplans/          # Rasterized floor plan images

backend/
├── parse_floorplan.py              # PDF → room/hallway graph extraction
├── export_grids.py                 # PDF → binary occupancy grids + distance transforms
├── inject_vertical_transport.py    # Adds elevator/stairwell nodes and inter-floor edges
└── generate_stylized_floorplans.py # Renders clean floor plan PNGs

supabase/
└── ...                      # Schema migrations and RLS policies
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** v18+
- **Python** 3.10+ *(for backend scripts only)*
- **Xcode** (iOS) or **Android Studio** (Android)

### Install & Run

```bash
cd frontend
npm install
```

**iOS Simulator**
```bash
npx expo run:ios
```

**Physical Device** *(plugged in via USB)*
```bash
npx expo run:ios --device
```

**Tunnel Mode** *(cross-network testing)*
```bash
npx expo start --tunnel
```

### Environment Variables

Create `frontend/.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=your_url_here
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_key_here
```

---

## 🔄 Regenerating Floor Grids

If the building PDF or grid parameters change:

```bash
cd backend
python export_grids.py /path/to/GDC.pdf --out ../frontend/assets/grids
```

Then rebuild to pick up the new grid files:

```bash
npx expo start --clear
```

---

<div align="center">

**Made at UT Austin 🤘**

</div>
