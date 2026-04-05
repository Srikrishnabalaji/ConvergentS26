#!/usr/bin/env python3
"""Regenerate all edge paths in gdc_graph.json using corridor-grid pathfinding.

Uses grid_navigation.py's proven approach:
  1. Build occupancy grid from floor plan image
  2. Block room interiors using contour detection
  3. Generate corridor-only grid
  4. A* pathfind between edge endpoints on the corridor grid
  5. Smooth paths to remove redundant waypoints
  6. Store as normalized-coord path waypoints in the JSON

This replaces the noisy path data from parse_floorplan.py with clean,
corridor-following paths that never cut through walls.

Usage:
    python3.13 regenerate_paths.py
"""

import cv2
import numpy as np
import json
import math
import heapq

GRAPH_PATH = "frontend/assets/gdc_graph.json"
FLOORPLAN_DIR = "frontend/assets/floorplans"

# Crop parameters matching extract_floor_images.py
CROP = {"left": 0.03, "top": 0.06, "right": 0.97, "bottom": 0.84}
CROP_W = CROP["right"] - CROP["left"]
CROP_H = CROP["bottom"] - CROP["top"]

GRID_SPACING = 15  # pixels between grid points (smaller = more precise paths)


def norm_to_px(nx, ny, w, h):
    """Convert normalized (0-1) coords to pixel coords in cropped image."""
    px = ((nx - CROP["left"]) / CROP_W) * w
    py = ((ny - CROP["top"]) / CROP_H) * h
    return int(round(px)), int(round(py))


def px_to_norm(px, py, w, h):
    """Convert pixel coords in cropped image to normalized (0-1) coords."""
    nx = (px / w) * CROP_W + CROP["left"]
    ny = (py / h) * CROP_H + CROP["top"]
    return round(nx, 5), round(ny, 5)


def build_corridor_grid(img_path, floor_nodes):
    """Build a corridor-only occupancy grid from a floor plan image.

    Uses the same approach as grid_navigation.py:
    - Binarize image
    - Flood fill exterior
    - Block room interiors using contour detection
    - Generate grid points only in corridor space
    """
    img = cv2.imread(img_path)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape

    # Binarize — white = open space, black = walls
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # For cropped floor plan images, the building fills the entire image.
    # Skip exterior flood fill — just use binary directly as valid space.
    valid_space = binary.copy()

    # Separate room and corridor nodes
    rooms = [n for n in floor_nodes if n["type"] in ("room", "bathroom")]
    corridors = [n for n in floor_nodes if n["type"] in ("corridor", "hallway")]

    # Block room interiors using contour detection
    inverted = cv2.bitwise_not(binary)
    contours, _ = cv2.findContours(
        inverted, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )

    room_mask = valid_space.copy()
    blocked = 0

    for node in rooms:
        rx, ry = norm_to_px(node["x"], node["y"], width, height)
        if not (0 <= rx < width and 0 <= ry < height):
            continue

        best_contour = None
        best_area = float("inf")

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 2000 or area > width * height * 0.15:
                continue
            result = cv2.pointPolygonTest(
                contour, (float(rx), float(ry)), False
            )
            if result >= 0 and area < best_area:
                best_area = area
                best_contour = contour

        if best_contour is not None:
            # Don't block if a corridor node is inside
            corridor_inside = False
            for corridor in corridors:
                cx, cy = norm_to_px(corridor["x"], corridor["y"], width, height)
                if cv2.pointPolygonTest(
                    best_contour, (float(cx), float(cy)), False
                ) >= 0:
                    corridor_inside = True
                    break
            if not corridor_inside:
                cv2.drawContours(room_mask, [best_contour], -1, 0, -1)
                blocked += 1

    # Light erosion — just enough to avoid hugging walls, not enough to
    # block narrow corridors
    kernel = np.ones((3, 3), np.uint8)
    room_mask = cv2.erode(room_mask, kernel, iterations=1)

    # Generate grid points in corridor space
    grid_points = {}
    for y in range(0, height, GRID_SPACING):
        for x in range(0, width, GRID_SPACING):
            if room_mask[y, x] == 255:
                grid_points[(x, y)] = len(grid_points)

    # Build adjacency (4-connected: up/down/left/right only)
    adjacency = {}
    directions = [
        (GRID_SPACING, 0),
        (-GRID_SPACING, 0),
        (0, GRID_SPACING),
        (0, -GRID_SPACING),
    ]

    for (x, y), pid in grid_points.items():
        neighbors = []
        for dx, dy in directions:
            nb = (x + dx, y + dy)
            if nb in grid_points:
                dist = abs(dx) + abs(dy)
                neighbors.append((grid_points[nb], dist, nb))
        adjacency[pid] = neighbors

    # Find largest connected component
    all_ids = set(grid_points.values())
    unvisited = set(all_ids)
    components = []
    while unvisited:
        start = next(iter(unvisited))
        visited = set()
        queue = [start]
        while queue:
            current = queue.pop(0)
            if current in visited:
                continue
            visited.add(current)
            unvisited.discard(current)
            for nb_id, _, _ in adjacency.get(current, []):
                if nb_id not in visited:
                    queue.append(nb_id)
        components.append(visited)

    components.sort(key=len, reverse=True)
    main_component = components[0] if components else set()

    # Build reverse lookup: point_id → (x, y)
    id_to_pos = {pid: pos for pos, pid in grid_points.items()}

    return {
        "grid_points": grid_points,
        "adjacency": adjacency,
        "main_component": main_component,
        "id_to_pos": id_to_pos,
        "width": width,
        "height": height,
        "room_mask": room_mask,
    }


def find_nearest_grid_point(grid, px, py):
    """Find the nearest grid point to a pixel position."""
    best_id = None
    best_dist = float("inf")

    # Search nearby grid positions first
    gx = round(px / GRID_SPACING) * GRID_SPACING
    gy = round(py / GRID_SPACING) * GRID_SPACING

    search_radius = GRID_SPACING * 10
    for dx in range(-search_radius, search_radius + 1, GRID_SPACING):
        for dy in range(-search_radius, search_radius + 1, GRID_SPACING):
            pos = (gx + dx, gy + dy)
            if pos in grid["grid_points"]:
                pid = grid["grid_points"][pos]
                if pid in grid["main_component"]:
                    dist = math.hypot(px - pos[0], py - pos[1])
                    if dist < best_dist:
                        best_dist = dist
                        best_id = pid

    return best_id, best_dist


def grid_astar(grid, start_id, end_id):
    """A* pathfinding on the corridor grid."""
    if start_id is None or end_id is None:
        return None

    id_to_pos = grid["id_to_pos"]
    adjacency = grid["adjacency"]

    sx, sy = id_to_pos[start_id]
    ex, ey = id_to_pos[end_id]

    def heuristic(pid):
        px, py = id_to_pos[pid]
        return abs(px - ex) + abs(py - ey)

    g_score = {start_id: 0}
    open_set = [(heuristic(start_id), start_id)]
    came_from = {}
    closed = set()

    while open_set:
        _, current = heapq.heappop(open_set)
        if current == end_id:
            path = [end_id]
            while path[-1] in came_from:
                path.append(came_from[path[-1]])
            path.reverse()
            return path
        if current in closed:
            continue
        closed.add(current)
        for nb_id, weight, _ in adjacency.get(current, []):
            if nb_id in closed:
                continue
            tg = g_score[current] + weight
            if tg < g_score.get(nb_id, float("inf")):
                came_from[nb_id] = current
                g_score[nb_id] = tg
                heapq.heappush(open_set, (tg + heuristic(nb_id), nb_id))

    return None


def smooth_path(path_ids, id_to_pos):
    """Remove intermediate points that are collinear (same direction)."""
    if len(path_ids) <= 2:
        return path_ids

    smoothed = [path_ids[0]]
    i = 0

    while i < len(path_ids) - 1:
        furthest = i + 1
        for j in range(i + 2, len(path_ids)):
            p_start = id_to_pos[path_ids[i]]
            p_end = id_to_pos[path_ids[j]]
            dx = p_end[0] - p_start[0]
            dy = p_end[1] - p_start[1]

            all_collinear = True
            for k in range(i + 1, j):
                p_mid = id_to_pos[path_ids[k]]
                mid_dx = p_mid[0] - p_start[0]
                mid_dy = p_mid[1] - p_start[1]
                cross = dx * mid_dy - dy * mid_dx
                if cross != 0:
                    all_collinear = False
                    break

            if all_collinear:
                furthest = j
            else:
                break

        smoothed.append(path_ids[furthest])
        i = furthest

    return smoothed


def los_check(room_mask, x1, y1, x2, y2):
    """Check line-of-sight between two pixel positions using Bresenham."""
    dx = abs(x2 - x1)
    dy = abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    err = dx - dy
    h, w = room_mask.shape

    while True:
        if 0 <= x1 < w and 0 <= y1 < h:
            if room_mask[y1, x1] == 0:
                return False
        else:
            return False
        if x1 == x2 and y1 == y2:
            break
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x1 += sx
        if e2 < dx:
            err += dx
            y1 += sy

    return True


def los_smooth(path_px, room_mask):
    """Line-of-sight smoothing: skip waypoints when direct path is clear."""
    if len(path_px) <= 2:
        return path_px

    result = [path_px[0]]
    i = 0

    while i < len(path_px) - 1:
        # Find the furthest point we can see directly
        best = i + 1
        for j in range(len(path_px) - 1, i + 1, -1):
            x1, y1 = result[-1]
            x2, y2 = path_px[j]
            if los_check(room_mask, x1, y1, x2, y2):
                best = j
                break
        result.append(path_px[best])
        i = best

    return result


def main():
    with open(GRAPH_PATH) as f:
        data = json.load(f)

    nodes = {n["id"]: n for n in data["nodes"]}
    floors = data["floors"]

    # Group nodes and edges by floor
    floor_nodes = {}
    for n in data["nodes"]:
        floor_nodes.setdefault(n["floorId"], []).append(n)

    floor_edges = {}
    for e in data["edges"]:
        if e.get("interFloor"):
            continue
        fn = nodes.get(e["from"])
        tn = nodes.get(e["to"])
        if fn and tn and fn["floorId"] == tn["floorId"]:
            floor_edges.setdefault(fn["floorId"], []).append(e)

    total_updated = 0
    total_failed = 0

    for floor in floors:
        fid = floor["id"]
        floor_num = int(fid[1:]) + 1
        img_path = f"{FLOORPLAN_DIR}/gdc_floor_{floor_num}.png"
        f_nodes = floor_nodes.get(fid, [])
        f_edges = floor_edges.get(fid, [])

        print(f"\n{'='*60}")
        print(f"Floor {floor_num} ({fid}): {len(f_nodes)} nodes, {len(f_edges)} edges")
        print(f"{'='*60}")

        # Build corridor grid
        print("  Building corridor grid...")
        grid = build_corridor_grid(img_path, f_nodes)
        print(f"  Grid: {len(grid['grid_points'])} points, "
              f"{len(grid['main_component'])} in main component")

        # Snap all nodes to nearest grid points
        node_grid_ids = {}
        for n in f_nodes:
            px, py = norm_to_px(n["x"], n["y"], grid["width"], grid["height"])
            gid, dist = find_nearest_grid_point(grid, px, py)
            node_grid_ids[n["id"]] = gid
            if gid is None:
                print(f"  WARNING: {n['label']} has no nearby grid point "
                      f"(px={px}, py={py})")

        # Pathfind for each edge
        updated = 0
        failed = 0

        for e in f_edges:
            from_gid = node_grid_ids.get(e["from"])
            to_gid = node_grid_ids.get(e["to"])

            if from_gid is None or to_gid is None:
                failed += 1
                continue

            if from_gid == to_gid:
                # Same grid point — just use the node positions
                fn = nodes[e["from"]]
                tn = nodes[e["to"]]
                e["path"] = [[fn["x"], fn["y"]], [tn["x"], tn["y"]]]
                updated += 1
                continue

            path = grid_astar(grid, from_gid, to_gid)
            if path is None:
                failed += 1
                continue

            # Smooth: first remove collinear points
            smoothed = smooth_path(path, grid["id_to_pos"])

            # Convert to pixel coords
            path_px = [grid["id_to_pos"][pid] for pid in smoothed]

            # LOS smoothing: skip waypoints when direct path is clear
            path_px = los_smooth(path_px, grid["room_mask"])

            # Convert to normalized coords
            path_norm = [
                list(px_to_norm(px, py, grid["width"], grid["height"]))
                for px, py in path_px
            ]

            e["path"] = path_norm
            updated += 1

        print(f"  Updated: {updated}, Failed: {failed}")
        total_updated += updated
        total_failed += failed

    print(f"\n{'='*60}")
    print(f"Total: {total_updated} edges updated, {total_failed} failed")
    print(f"{'='*60}")

    with open(GRAPH_PATH, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nSaved to {GRAPH_PATH}")


if __name__ == "__main__":
    main()
