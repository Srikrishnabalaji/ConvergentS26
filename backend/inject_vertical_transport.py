#!/usr/bin/env python3
"""Inject stairwell and elevator nodes into the GDC navigation graph.

The OCR-based detection misses most stairwells because their labels span
multiple lines (e.g. "STAIRS\n5.352"). This script manually adds them at
known positions that are consistent across all GDC floors, then creates
inter-floor edges between consecutive floors.

Key design choices:
  - Transport nodes are placed AT the nearest connected room's position
    so paths don't cut through walls.
  - Each transport node connects to multiple nearby rooms (up to 5) to
    bridge disconnected floor components.
  - Elevator inter-floor weight is very low (10) so A* prefers taking the
    elevator directly to the destination floor.

Usage:
    python inject_vertical_transport.py frontend/assets/gdc_graph.json
"""

import json, sys, random, string, math

def uid(k=7):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=k))


# ── Known vertical transport positions in GDC (normalized 0-1 coords) ──
# These are corridor positions right next to the elevator/stairwell entrance,
# NOT the room positions. Verified against floor plan images.
VERTICAL_TRANSPORT = [
    # (name, type, approx_x, approx_y, inter_floor_weight)
    ("West Stairs",      "stairwell", 0.280, 0.320, 500),
    ("East Stairs",      "stairwell", 0.740, 0.295, 500),
    ("Central Elevator", "elevator",  0.435, 0.390, 5),   # low weight so A* strongly prefers elevator
    ("SW Stairs",        "stairwell", 0.275, 0.690, 500),
    ("SE Stairs",        "stairwell", 0.555, 0.600, 500),
]


def find_connected_components(nodes, edges):
    """Union-Find to identify connected components per floor."""
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

    components = {}
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
    nodes = data["nodes"]
    edges = data["edges"]

    # Remove existing stairwell/elevator nodes and their edges
    old_vt_ids = {n["id"] for n in nodes if n.get("type") in ("stairwell", "elevator")}
    nodes = [n for n in nodes if n["id"] not in old_vt_ids]
    edges = [e for e in edges
             if not e.get("interFloor")
             and e["from"] not in old_vt_ids
             and e["to"] not in old_vt_ids]

    print(f"Removed {len(old_vt_ids)} old stairwell/elevator nodes")

    # Build edge-count index
    edge_count = {}
    for e in edges:
        edge_count[e["from"]] = edge_count.get(e["from"], 0) + 1
        edge_count[e["to"]] = edge_count.get(e["to"], 0) + 1

    # Index rooms by floor
    floor_rooms = {}
    for n in nodes:
        floor_rooms.setdefault(n["floorId"], []).append(n)

    # Find connected components per floor
    floor_components = {}
    for fid in floor_rooms:
        frooms = floor_rooms[fid]
        floor_components[fid] = find_connected_components(frooms, edges)

    transport_groups = {}

    for vt_name, vt_type, vt_x, vt_y, vt_weight in VERTICAL_TRANSPORT:
        group_id = uid()
        transport_groups[vt_name] = {
            "group_id": group_id,
            "floors": {},
            "weight": vt_weight,
        }

        for floor in floors:
            fid = floor["id"]
            rooms = floor_rooms.get(fid, [])
            if not rooms:
                continue

            # Place the transport node at its ACTUAL corridor position,
            # NOT snapped to a room. This prevents diagonal wall-cutting.
            node_id = uid()
            node = {
                "id": node_id,
                "floorId": fid,
                "x": vt_x,
                "y": vt_y,
                "label": vt_name,
                "type": vt_type,
                "groupId": group_id,
            }
            nodes.append(node)
            transport_groups[vt_name]["floors"][fid] = node_id

            # Connect to the closest rooms that have edges (are reachable).
            # Use multiple connections to bridge disconnected components.
            connected_rooms = [r for r in rooms if edge_count.get(r["id"], 0) > 0]
            if not connected_rooms:
                connected_rooms = rooms

            # Sort by distance and connect to the nearest rooms
            by_dist = sorted(connected_rooms,
                             key=lambda n: math.hypot(n["x"] - vt_x, n["y"] - vt_y))

            # Connect to nearby rooms in two passes:
            # 1) The closest rooms regardless of component (for best routing)
            # 2) The closest room in each remaining component (for bridging)
            connected_ids = set()
            connected_components = set()
            connections = 0

            # Pass 1: connect to the N closest rooms (best routing options)
            for room in by_dist[:4]:
                dist = math.hypot(room["x"] - vt_x, room["y"] - vt_y)
                if dist > 0.20:
                    break
                weight = 200 + dist * 200
                edges.append({
                    "id": uid(),
                    "from": node_id,
                    "to": room["id"],
                    "weight": weight,
                    "interFloor": False,
                })
                connected_ids.add(room["id"])
                connections += 1
                # Track component
                for comp in floor_components[fid]:
                    if room["id"] in {n["id"] for n in comp}:
                        connected_components.add(id(comp))
                        break

            # Pass 2: bridge any remaining disconnected components
            for comp in floor_components[fid]:
                if id(comp) in connected_components:
                    continue
                if len(comp) < 2:
                    continue
                comp_connected = [r for r in comp if edge_count.get(r["id"], 0) > 0]
                if not comp_connected:
                    continue
                comp_nearest = min(comp_connected,
                                   key=lambda n: math.hypot(n["x"] - vt_x, n["y"] - vt_y))
                dist = math.hypot(comp_nearest["x"] - vt_x, comp_nearest["y"] - vt_y)
                if dist > 0.25:
                    continue
                edges.append({
                    "id": uid(),
                    "from": node_id,
                    "to": comp_nearest["id"],
                    "weight": 200 + dist * 200,
                    "interFloor": False,
                })
                connected_ids.add(comp_nearest["id"])
                connections += 1

            print(f"  {vt_type:10s} '{vt_name}' on {floor['name']:8s} "
                  f"→ at ({vt_x:.3f}, {vt_y:.3f}), {connections} connection(s)")

    # Create inter-floor edges
    inter_count = 0
    for vt_name, group in transport_groups.items():
        floor_ids = sorted(group["floors"].keys())
        weight = group["weight"]
        for i in range(len(floor_ids) - 1):
            f_a = floor_ids[i]
            f_b = floor_ids[i + 1]
            edges.append({
                "id": uid(),
                "from": group["floors"][f_a],
                "to": group["floors"][f_b],
                "weight": weight,
                "interFloor": True,
            })
            inter_count += 1

    total_added = sum(len(g["floors"]) for g in transport_groups.values())
    print(f"\nAdded {total_added} transport nodes, {inter_count} inter-floor edges")

    data["nodes"] = nodes
    data["edges"] = edges
    data["meta"]["nodeCount"] = len(nodes)
    data["meta"]["edgeCount"] = len(edges)

    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    print(f"Saved to {path}")


if __name__ == "__main__":
    main()
