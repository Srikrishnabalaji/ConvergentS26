#!/usr/bin/env python3
"""Inject stairwell and elevator nodes into the GDC navigation graph.

The OCR-based detection misses stairwells/elevators so this script adds
them manually at known positions, then creates inter-floor edges between
consecutive floors.

The within-floor transport→room edges carry only a weight (no path array).
Actual corridor-following paths are computed at runtime by the app's
grid-based A* engine using the pre-rendered occupancy grids.

Usage:
    python inject_vertical_transport.py frontend/assets/gdc_graph.json
"""

import json, sys, os, random, string, math

def uid(k=7):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=k))


# ── Known vertical transport positions (normalized 0-1, full PDF page) ──
# Verified against GDC floor plan images.
# (name, type, x, y, inter_floor_weight)
VERTICAL_TRANSPORT = [
    ("West Stairs",      "stairwell", 0.280, 0.320, 500),
    ("East Stairs",      "stairwell", 0.740, 0.295, 500),
    ("Central Elevator", "elevator",  0.435, 0.390, 5),
    ("SW Stairs",        "stairwell", 0.275, 0.690, 500),
    ("SE Stairs",        "stairwell", 0.555, 0.600, 500),
]

# Maximum number of nearest rooms to connect per transport per floor.
# More connections means better routing options if one path is blocked.
MAX_ROOM_CONNECTIONS = 4
# Don't connect to rooms farther than this (normalized units).
MAX_CONNECT_DIST = 0.22


def find_connected_components(nodes, edges):
    """Union-Find: returns list of node-lists, one per connected component."""
    parent = {n["id"]: n["id"] for n in nodes}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    node_ids = {n["id"] for n in nodes}
    for e in edges:
        if e["from"] in node_ids and e["to"] in node_ids and not e.get("interFloor"):
            union(e["from"], e["to"])

    components: dict = {}
    for n in nodes:
        root = find(n["id"])
        components.setdefault(root, []).append(n)
    return list(components.values())


def main():
    if len(sys.argv) < 2:
        print("Usage: python inject_vertical_transport.py <graph.json>")
        sys.exit(1)

    path = sys.argv[1]
    with open(path) as f:
        data = json.load(f)

    floors = data["floors"]
    nodes  = data["nodes"]
    edges  = data["edges"]

    # Remove existing transport nodes and all their edges so we can
    # re-inject from scratch with consistent IDs and positions.
    old_vt_ids = {n["id"] for n in nodes if n.get("type") in ("stairwell", "elevator")}
    nodes = [n for n in nodes if n["id"] not in old_vt_ids]
    edges = [e for e in edges
             if not e.get("interFloor")
             and e["from"] not in old_vt_ids
             and e["to"]   not in old_vt_ids]
    print(f"Removed {len(old_vt_ids)} old transport nodes")

    # Build edge-count index so we prefer well-connected rooms.
    edge_count: dict = {}
    for e in edges:
        edge_count[e["from"]] = edge_count.get(e["from"], 0) + 1
        edge_count[e["to"]]   = edge_count.get(e["to"],   0) + 1

    # Index rooms by floor.
    floor_rooms: dict = {}
    for n in nodes:
        floor_rooms.setdefault(n["floorId"], []).append(n)

    # Connected components per floor (to ensure we bridge isolated islands).
    floor_comps: dict = {}
    for fid in floor_rooms:
        floor_comps[fid] = find_connected_components(floor_rooms[fid], edges)

    transport_groups: dict = {}

    for vt_name, vt_type, vt_x, vt_y, vt_weight in VERTICAL_TRANSPORT:
        group_id = uid()
        transport_groups[vt_name] = {
            "group_id": group_id,
            "floors": {},
            "weight": vt_weight,
        }

        for floor in floors:
            fid   = floor["id"]
            rooms = floor_rooms.get(fid, [])
            if not rooms:
                continue

            node_id = uid()
            node = {
                "id":      node_id,
                "floorId": fid,
                "x":       vt_x,
                "y":       vt_y,
                "label":   vt_name,
                "type":    vt_type,
                "groupId": group_id,
            }
            nodes.append(node)
            transport_groups[vt_name]["floors"][fid] = node_id

            # Prefer rooms that already have edges (well-connected nodes).
            connected = [r for r in rooms if edge_count.get(r["id"], 0) > 0]
            if not connected:
                connected = rooms

            by_dist = sorted(connected,
                             key=lambda r: math.hypot(r["x"] - vt_x, r["y"] - vt_y))

            # Pass 1: up to MAX_ROOM_CONNECTIONS nearest rooms within distance cap.
            seen_ids: set = set()
            seen_comps: set = set()
            connections = 0

            for room in by_dist:
                if connections >= MAX_ROOM_CONNECTIONS:
                    break
                d = math.hypot(room["x"] - vt_x, room["y"] - vt_y)
                if d > MAX_CONNECT_DIST:
                    break
                if room["id"] in seen_ids:
                    continue
                # Weight reflects traversal cost; the app's A* uses this for
                # high-level routing (which transport to take, which route to
                # prefer). The actual visual path is drawn by the grid A*.
                w = 200 + d * 300
                edges.append({
                    "id":         uid(),
                    "from":       node_id,
                    "to":         room["id"],
                    "weight":     round(w, 1),
                    "interFloor": False,
                })
                seen_ids.add(room["id"])
                connections += 1
                for comp in floor_comps.get(fid, []):
                    if room["id"] in {n["id"] for n in comp}:
                        seen_comps.add(id(comp))
                        break

            # Pass 2: bridge disconnected components (so A* can reach all rooms
            # even if they aren't adjacent to the transport node).
            for comp in floor_comps.get(fid, []):
                if id(comp) in seen_comps or len(comp) < 2:
                    continue
                comp_ok = [r for r in comp if edge_count.get(r["id"], 0) > 0]
                if not comp_ok:
                    continue
                nearest = min(comp_ok,
                              key=lambda r: math.hypot(r["x"] - vt_x, r["y"] - vt_y))
                d = math.hypot(nearest["x"] - vt_x, nearest["y"] - vt_y)
                if d > MAX_CONNECT_DIST * 1.5 or nearest["id"] in seen_ids:
                    continue
                edges.append({
                    "id":         uid(),
                    "from":       node_id,
                    "to":         nearest["id"],
                    "weight":     round(200 + d * 300, 1),
                    "interFloor": False,
                })
                seen_ids.add(nearest["id"])
                connections += 1

            print(f"  {vt_type:10s} '{vt_name}' on {floor['name']:8s} "
                  f"→ ({vt_x:.3f},{vt_y:.3f}), {connections} room(s)")

    # Create inter-floor edges linking the same transport across floors.
    inter_count = 0
    for vt_name, group in transport_groups.items():
        floor_ids = sorted(group["floors"].keys())
        w = group["weight"]
        for i in range(len(floor_ids) - 1):
            fa, fb = floor_ids[i], floor_ids[i + 1]
            edges.append({
                "id":         uid(),
                "from":       group["floors"][fa],
                "to":         group["floors"][fb],
                "weight":     w,
                "interFloor": True,
            })
            inter_count += 1

    total_added = sum(len(g["floors"]) for g in transport_groups.values())
    print(f"\nAdded {total_added} transport nodes, {inter_count} inter-floor edges")

    data["nodes"] = nodes
    data["edges"] = edges
    data.setdefault("meta", {})
    data["meta"]["nodeCount"] = len(nodes)
    data["meta"]["edgeCount"] = len(edges)

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved {path}  ({len(nodes)} nodes, {len(edges)} edges)")


if __name__ == "__main__":
    main()
