import cv2
import numpy as np
import json
import math
import heapq


# ── GRID GENERATION ──────────────────────────────────────────────────────
def generate_grid(image_path, nodes_file, grid_spacing=30):
    img = cv2.imread(image_path)
    if img is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    height, width = gray.shape
    print(f"Image size: {width}x{height}")

    # Binarize
    _, binary = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # Flood fill exterior to isolate building interior
    flood_mask = np.zeros((height + 2, width + 2), np.uint8)
    binary_copy = binary.copy()
    cv2.floodFill(binary_copy, flood_mask, (0, 0), 128)
    valid_space = np.zeros_like(binary)
    valid_space[binary_copy == 255] = 255

    # Load classified nodes
    with open(nodes_file, 'r') as f:
        nodes = json.load(f)

    rooms     = [n for n in nodes if n['type'] == 'room']
    corridors = [n for n in nodes if n['type'] == 'corridor']
    bathrooms = [n for n in nodes if n['type'] == 'bathroom']

    # Block rooms and bathrooms using contour detection
    to_block = rooms + bathrooms
    inverted = cv2.bitwise_not(binary)
    contours, _ = cv2.findContours(
        inverted, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE
    )

    room_mask = valid_space.copy()
    blocked_count = 0

    for node in to_block:
        rx, ry = int(node['x']), int(node['y'])
        if not (0 <= rx < width and 0 <= ry < height):
            continue

        best_contour = None
        best_area = float('inf')

        for contour in contours:
            area = cv2.contourArea(contour)
            if area < 3000 or area > width * height * 0.15:
                continue
            result = cv2.pointPolygonTest(
                contour, (float(rx), float(ry)), False
            )
            if result >= 0 and area < best_area:
                best_area = area
                best_contour = contour

        if best_contour is not None:
            corridor_inside = False
            for corridor in corridors:
                cx, cy = int(corridor['x']), int(corridor['y'])
                if cv2.pointPolygonTest(
                    best_contour, (float(cx), float(cy)), False
                ) >= 0:
                    corridor_inside = True
                    break
            if not corridor_inside:
                cv2.drawContours(room_mask, [best_contour], -1, 0, -1)
                blocked_count += 1

    print(f"Nodes blocked: {blocked_count}/{len(to_block)}")
    cv2.imwrite("room_blocked_mask.png", room_mask)

    # Generate grid points on corridor-only space
    grid_points = {}
    point_id = 0
    for y in range(0, height, grid_spacing):
        for x in range(0, width, grid_spacing):
            if room_mask[y, x] == 255:
                grid_points[(x, y)] = {
                    "id": point_id,
                    "x": x,
                    "y": y,
                    "type": "waypoint"
                }
                point_id += 1

    # Connect horizontal and vertical neighbors only — no diagonals
    directions = [
        (grid_spacing, 0),
        (-grid_spacing, 0),
        (0, grid_spacing),
        (0, -grid_spacing)
    ]

    edges = []
    for (x, y), point in grid_points.items():
        for dx, dy in directions:
            neighbor = (x + dx, y + dy)
            if neighbor in grid_points:
                dist = math.sqrt(dx**2 + dy**2)
                edges.append({
                    "from_id": point["id"],
                    "to_id": grid_points[neighbor]["id"],
                    "distance": round(dist, 2)
                })

    # Find largest connected component
    adjacency = {}
    for edge in edges:
        fid, tid = edge["from_id"], edge["to_id"]
        adjacency.setdefault(fid, []).append(tid)
        adjacency.setdefault(tid, []).append(fid)

    all_ids = list({p["id"] for p in grid_points.values()})
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
            for nb in adjacency.get(current, []):
                if nb not in visited:
                    queue.append(nb)
        components.append(visited)

    components.sort(key=len, reverse=True)
    main_component = components[0]

    print(f"Grid points: {len(grid_points)}")
    print(f"Edges: {len(edges)}")
    print(f"Main component: {len(main_component)}/{len(all_ids)} nodes")

    return img, valid_space, room_mask, grid_points, edges, main_component


# ── SNAP ROOMS TO GRID ───────────────────────────────────────────────────
def snap_rooms_to_grid(nodes_file, grid_points, main_component):
    with open(nodes_file, 'r') as f:
        nodes = json.load(f)

    # Only snap to nodes in main connected component
    gp_list = [
        p for p in grid_points.values()
        if p["id"] in main_component
    ]

    snapped = []
    for node in nodes:
        if node['type'] == 'waypoint':
            continue
        nearest = None
        nearest_dist = float('inf')
        for gp in gp_list:
            d = math.sqrt(
                (node['x'] - gp['x'])**2 +
                (node['y'] - gp['y'])**2
            )
            if d < nearest_dist:
                nearest_dist = d
                nearest = gp
        if nearest:
            snapped.append({
                "label": node['label'],
                "type": node['type'],
                "x": node['x'],
                "y": node['y'],
                "nearest_grid_id": nearest['id'],
                "nearest_grid_x": nearest['x'],
                "nearest_grid_y": nearest['y'],
                "snap_distance": round(nearest_dist, 2)
            })

    print(f"Snapped nodes: {len(snapped)}")
    return snapped


# ── A* PATHFINDING ───────────────────────────────────────────────────────
def astar(start_id, end_id, grid_points, edges,
          avoid_stairs=False, stair_node_ids=None):
    id_to_point = {p["id"]: p for p in grid_points.values()}

    adjacency = {}
    for edge in edges:
        fid, tid, dist = edge["from_id"], edge["to_id"], edge["distance"]
        adjacency.setdefault(fid, []).append((tid, dist))
        adjacency.setdefault(tid, []).append((fid, dist))

    def heuristic(a, b):
        pa, pb = id_to_point[a], id_to_point[b]
        # Manhattan distance discourages diagonal movement patterns
        return abs(pa['x'] - pb['x']) + abs(pa['y'] - pb['y'])

    open_set  = [(0, start_id)]
    came_from = {}
    g_score   = {start_id: 0}

    while open_set:
        _, current = heapq.heappop(open_set)
        if current == end_id:
            path = []
            while current in came_from:
                path.append(current)
                current = came_from[current]
            path.append(start_id)
            path.reverse()
            return path
        for neighbor, weight in adjacency.get(current, []):
            if avoid_stairs and stair_node_ids and \
               neighbor in stair_node_ids:
                weight += 9999
            tg = g_score.get(current, float('inf')) + weight
            if tg < g_score.get(neighbor, float('inf')):
                came_from[neighbor] = current
                g_score[neighbor]   = tg
                heapq.heappush(
                    open_set,
                    (tg + heuristic(neighbor, end_id), neighbor)
                )
    return None


# ── PATH SMOOTHING ───────────────────────────────────────────────────────
def smooth_path(path, id_to_point):
    if len(path) <= 2:
        return path

    smoothed = [path[0]]
    i = 0

    while i < len(path) - 1:
        furthest = i + 1
        for j in range(i + 2, len(path)):
            p_start = id_to_point[path[i]]
            p_end   = id_to_point[path[j]]
            dx = p_end['x'] - p_start['x']
            dy = p_end['y'] - p_start['y']

            all_collinear = True
            for k in range(i + 1, j):
                p_mid  = id_to_point[path[k]]
                mid_dx = p_mid['x'] - p_start['x']
                mid_dy = p_mid['y'] - p_start['y']
                cross  = dx * mid_dy - dy * mid_dx
                if cross != 0:
                    all_collinear = False
                    break

            if all_collinear:
                furthest = j
            else:
                break

        smoothed.append(path[furthest])
        i = furthest

    return smoothed


# ── VISUALIZE PATH ───────────────────────────────────────────────────────
def visualize_path(img, path, smoothed, grid_points,
                   snapped_nodes, start_label, end_label,
                   output_path):
    id_to_point = {p["id"]: p for p in grid_points.values()}
    output = img.copy()

    COLORS = {
        "room":      (0, 180, 0),
        "corridor":  (255, 140, 0),
        "stairs":    (0, 0, 255),
        "elevator":  (255, 0, 255),
        "bathroom":  (0, 255, 255),
    }

    # Draw smoothed path
    for i in range(len(smoothed) - 1):
        p1 = id_to_point[smoothed[i]]
        p2 = id_to_point[smoothed[i + 1]]
        cv2.line(output,
                 (p1['x'], p1['y']),
                 (p2['x'], p2['y']),
                 (255, 80, 0), 4)

    # Draw turn point markers
    for pid in smoothed:
        p = id_to_point[pid]
        cv2.circle(output, (p['x'], p['y']), 5, (200, 50, 0), -1)

    # Draw all room nodes
    for node in snapped_nodes:
        x, y  = int(node['x']), int(node['y'])
        color = COLORS.get(node['type'], (128, 128, 128))
        cv2.circle(output, (x, y), 7, color, -1)
        if node['label'] == start_label:
            cv2.circle(output, (x, y), 18, (0, 200, 0), 3)
            cv2.putText(output, "START: " + node['label'],
                        (x + 20, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7, (0, 180, 0), 2)
        elif node['label'] == end_label:
            cv2.circle(output, (x, y), 18, (0, 0, 200), 3)
            cv2.putText(output, "END: " + node['label'],
                        (x + 20, y - 10),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.7, (0, 0, 180), 2)

    cv2.imwrite(output_path, output)
    print(f"Saved {output_path}")


# ── VISUALIZE FULL GRAPH ─────────────────────────────────────────────────
def visualize_full_graph(img, grid_points, edges, snapped_nodes,
                          main_component, output_path):
    id_to_point = {p["id"]: p for p in grid_points.values()}
    output = img.copy()

    COLORS = {
        "room":      (0, 180, 0),
        "corridor":  (255, 140, 0),
        "stairs":    (0, 0, 255),
        "elevator":  (255, 0, 255),
        "bathroom":  (0, 255, 255),
    }

    # Draw all grid edges
    for edge in edges:
        if edge["from_id"] in main_component and \
           edge["to_id"] in main_component:
            p1 = id_to_point[edge["from_id"]]
            p2 = id_to_point[edge["to_id"]]
            cv2.line(output,
                     (p1['x'], p1['y']),
                     (p2['x'], p2['y']),
                     (220, 220, 220), 1)

    # Draw snap lines from room to nearest grid point
    for node in snapped_nodes:
        nx, ny = int(node['x']), int(node['y'])
        gx, gy = node['nearest_grid_x'], node['nearest_grid_y']
        color  = COLORS.get(node['type'], (128, 128, 128))
        cv2.line(output, (nx, ny), (gx, gy), color, 2)

    # Draw grid points as tiny dots
    for pid in main_component:
        p = id_to_point[pid]
        cv2.circle(output, (p['x'], p['y']), 2, (180, 180, 180), -1)

    # Draw room nodes on top
    for node in snapped_nodes:
        nx, ny = int(node['x']), int(node['y'])
        color  = COLORS.get(node['type'], (128, 128, 128))
        cv2.circle(output, (nx, ny), 8, color, -1)
        cv2.putText(output, node['label'], (nx + 10, ny - 5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)

    # Legend
    legend_y = 30
    for ntype, color in COLORS.items():
        cv2.circle(output, (20, legend_y), 6, color, -1)
        cv2.putText(output, ntype, (32, legend_y + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, color, 1)
        legend_y += 22

    cv2.imwrite(output_path, output)
    print(f"Saved {output_path}")


# ── MAIN ─────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    IMAGE_FILE = "floor_4.png"
    NODES_FILE = "classified_floor4.json"
    GRID_SPACING = 30

    print("Building grid...")
    img, valid_space, room_mask, grid_points, edges, main_component = \
        generate_grid(IMAGE_FILE, NODES_FILE, GRID_SPACING)

    print("\nSnapping nodes to grid...")
    snapped = snap_rooms_to_grid(NODES_FILE, grid_points, main_component)

    id_to_point = {p["id"]: p for p in grid_points.values()}

    print("\nGenerating full graph visualization...")
    visualize_full_graph(
        img.copy(), grid_points, edges, snapped,
        main_component, "full_graph_floor4.png"
    )

    # ── Test routes ───────────────────────────────────────────────────────
    test_routes = [
        ("4.302", "4.828"),
        ("4.440", "4.802"),
        ("4.306", "4.718"),
        ("4.802", "4.553"),
    ]

    print("\nRunning test routes...")
    for start_label, end_label in test_routes:
        start_node = next(
            (n for n in snapped if n['label'] == start_label), None
        )
        end_node = next(
            (n for n in snapped if n['label'] == end_label), None
        )

        if not start_node or not end_node:
            print(f"  {start_label} → {end_label}: room not found")
            continue

        path = astar(
            start_node['nearest_grid_id'],
            end_node['nearest_grid_id'],
            grid_points, edges
        )

        if path:
            smoothed = smooth_path(path, id_to_point)
            print(f"  {start_label} → {end_label}: "
                  f"{len(path)} waypoints → "
                  f"{len(smoothed)} after smoothing")
            visualize_path(
                img.copy(), path, smoothed,
                grid_points, snapped,
                start_label, end_label,
                f"path_{start_label}_to_{end_label}.png"
            )
        else:
            print(f"  {start_label} → {end_label}: NO PATH FOUND")