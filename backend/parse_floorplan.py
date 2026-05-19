#!/usr/bin/env python3
"""
parse_floorplan.py — Auto-generate a navigation graph from a multi-page floor-plan PDF.

Uses raster-based wall detection for wall-aware connectivity:
  1. Renders each page to a binary occupancy grid
  2. Extracts hallway skeletons via distance transform + morphological thinning
  3. Validates all edges with line-of-sight checks against the wall grid
  4. Creates proper room -> hallway -> room topology

Works with CAD-exported PDFs that have NO text layer (room numbers drawn as vector paths).
Uses multi-pass OCR on high-res renders + vector-based door arc detection.

Output JSON is compatible with the FloorGraph editor (floorplan-editor.html).

Install:
    pip install pymupdf easyocr opencv-python-headless

Usage:
    python parse_floorplan.py "C:/path/to/GDC.pdf" --building "Gates Dell Complex"
    python parse_floorplan.py GDC.pdf -o out.json --building "GDC"
    python parse_floorplan.py GDC.pdf --debug --ocr-engine both
"""

import argparse, json, math, os, re, random, string, sys, hashlib
import fitz  # PyMuPDF
import cv2
import numpy as np

# ── utilities ─────────────────────────────────────────────────────────────────

def uid(k=7):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=k))

def dist(ax, ay, bx, by):
    return math.hypot(ax - bx, ay - by)

def _point_seg_dist2(px, py, x0, y0, x1, y1):
    """Squared distance from point (px,py) to segment (x0,y0)-(x1,y1)."""
    dx, dy = x1 - x0, y1 - y0
    l2 = dx * dx + dy * dy
    if l2 == 0.0:
        return (px - x0) ** 2 + (py - y0) ** 2
    t = ((px - x0) * dx + (py - y0) * dy) / l2
    if t < 0.0:
        t = 0.0
    elif t > 1.0:
        t = 1.0
    qx, qy = x0 + t * dx, y0 + t * dy
    return (px - qx) ** 2 + (py - qy) ** 2

def _point_near_any_seg(px, py, segs, max_d):
    """True if (px,py) is within max_d of any segment in segs."""
    md2 = max_d * max_d
    for (x0, y0, x1, y1) in segs:
        if _point_seg_dist2(px, py, x0, y0, x1, y1) <= md2:
            return True
    return False

# ── node / edge ───────────────────────────────────────────────────────────────

class Node:
    __slots__ = ('id','floor_id','x','y','label','type','group_id')
    def __init__(self, id, floor_id, x, y, label, type_, group_id=None):
        self.id = id; self.floor_id = floor_id
        self.x = x;  self.y = y
        self.label = label; self.type = type_; self.group_id = group_id
    def to_dict(self):
        return {"id": self.id, "floorId": self.floor_id,
                "x": round(self.x, 5), "y": round(self.y, 5),
                "label": self.label, "type": self.type, "groupId": self.group_id}

class Edge:
    __slots__ = ('id','from_id','to_id','weight','inter_floor','path')
    def __init__(self, id, from_id, to_id, weight, inter_floor=False, path=None):
        self.id = id; self.from_id = from_id; self.to_id = to_id
        self.weight = weight; self.inter_floor = inter_floor
        self.path = path  # list of [x, y] normalized waypoints (corridor path)
    def to_dict(self):
        d = {"id": self.id, "from": self.from_id, "to": self.to_id,
             "weight": round(self.weight, 1), "interFloor": self.inter_floor}
        if self.path:
            d["path"] = [[round(x, 5), round(y, 5)] for x, y in self.path]
        return d

# ── Phase 1: Occupancy Grid ──────────────────────────────────────────────────

def render_occupancy_grid(page, scale=3, min_seg_len=1, wall_thickness=7):
    """Build a binary occupancy grid using hybrid raster + vector approach.

    Strategy:
    1. Rasterize the PDF page via PyMuPDF (walls, pillars, structural elements
       are all naturally rendered correctly)
    2. Threshold to binary grid
    3. Detect doors from vector data (quarter-circle arcs in paths that also
       contain straight lines = door leaf)
    4. Erase door sweep areas to create passable openings

    Returns (grid, scale) where grid[y,x] = 255 means passable, 0 means wall.
    """
    pw, ph = page.rect.width, page.rect.height
    w, h = int(pw * scale), int(ph * scale)

    margin = 0.10
    crop_top = int(h * margin)
    crop_bottom = int(h * (1.0 - 0.18))
    crop_left = int(w * margin)
    crop_right = int(w * (1.0 - margin))

    # === Step 1: Rasterize PDF page ===
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        gray = cv2.cvtColor(img, cv2.COLOR_RGBA2GRAY)
    elif pix.n == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    else:
        gray = img.copy()

    # Binary threshold: dark pixels (walls/ink) → 0, light pixels → 255
    _, grid = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

    # === Step 1b: Overlay vector wall segments ===
    # The raster catches pillars and structural elements correctly but walls
    # are broken/dotted due to 0.06pt stroke width. Draw vector line segments
    # on top to ensure walls are continuous and solid.
    # We also collect wall_segs (in PDF coords) for later door validation:
    # a real door's swing arc center should sit on or very near a wall stroke.
    wall_segs = []  # list of (x0, y0, x1, y1) in PDF coordinates
    MAX_LINE_FRAC = 0.70
    for path in page.get_drawings():
        items = path.get("items", [])
        for item in items:
            if item[0] == "l":
                x0, y0 = item[1].x * scale, item[1].y * scale
                x1, y1 = item[2].x * scale, item[2].y * scale
                seg_len = math.hypot(x1 - x0, y1 - y0) / scale
                if seg_len < min_seg_len:
                    continue
                # Skip annotation/grid lines spanning >70% of page
                dx_pdf = abs(item[2].x - item[1].x)
                dy_pdf = abs(item[2].y - item[1].y)
                if dx_pdf > pw * MAX_LINE_FRAC and dy_pdf < 2:
                    continue
                if dy_pdf > ph * MAX_LINE_FRAC and dx_pdf < 2:
                    continue
                cv2.line(grid, (int(x0), int(y0)), (int(x1), int(y1)),
                         0, wall_thickness)
                wall_segs.append((item[1].x, item[1].y, item[2].x, item[2].y))
            elif item[0] == "re":
                rect = item[1]
                rx0, ry0 = int(rect.x0 * scale), int(rect.y0 * scale)
                rx1, ry1 = int(rect.x1 * scale), int(rect.y1 * scale)
                rw, rh = abs(rx1 - rx0), abs(ry1 - ry0)
                if max(rw, rh) / scale < min_seg_len:
                    continue
                if rw < 80 * scale and rh < 80 * scale:
                    cv2.rectangle(grid, (rx0, ry0), (rx1, ry1), 0, -1)
                else:
                    cv2.rectangle(grid, (rx0, ry0), (rx1, ry1), 0, wall_thickness)

    # Morphological closing to seal corner/junction gaps
    wall_mask = cv2.bitwise_not(grid)
    close_kernel = np.ones((5, 5), np.uint8)
    wall_mask = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, close_kernel)
    grid = cv2.bitwise_not(wall_mask)

    # === Step 2: Detect doors from vector data ===
    # A real door has a very specific signature in the PDF:
    #   1. The path contains exactly ONE quarter-circle arc (the swing).
    #   2. The path contains a "leaf" line whose length ≈ arc radius.
    #   3. One leaf endpoint sits at the arc center (= hinge), the other
    #      at one of the arc endpoints (= open position).
    #   4. The arc center sits on or very near a wall stroke (doors are
    #      cut into walls; cabinet doors / fixture arcs are not).
    # Loose detection (any-arc + any-line) misfires on cabinets, sinks,
    # decorative arcs and punches phantom holes through walls.
    door_arcs = []
    for path in page.get_drawings():
        items = path.get("items", [])

        # Collect arcs (quarter circles) and lines from this path
        path_arcs = []
        path_lines = []
        for item in items:
            if item[0] == "c":
                p0 = (item[1].x, item[1].y)
                p1 = (item[2].x, item[2].y)
                p2 = (item[3].x, item[3].y)
                p3 = (item[4].x, item[4].y)
                ok, acx, acy, ar = is_quarter_circle(p0, p1, p2, p3)
                if ok and 4 <= ar <= 70:
                    path_arcs.append((acx, acy, ar, p0, p3))
            elif item[0] == "l":
                path_lines.append((item[1].x, item[1].y,
                                   item[2].x, item[2].y))

        # Check 1: exactly one quarter-circle arc
        if len(path_arcs) != 1:
            continue
        if not path_lines:
            continue

        acx, acy, ar, p0, p3 = path_arcs[0]
        leaf_tol = max(2.0, ar * 0.15)  # endpoint coincidence tolerance
        len_tol_lo = ar * 0.75
        len_tol_hi = ar * 1.25

        # Checks 2 + 3: find a leaf line of length≈r whose endpoints
        # match (arc center) and (one of the arc endpoints)
        leaf_found = False
        for (lx0, ly0, lx1, ly1) in path_lines:
            llen = math.hypot(lx1 - lx0, ly1 - ly0)
            if llen < len_tol_lo or llen > len_tol_hi:
                continue
            # one endpoint at hinge (arc center)?
            d_a_center = dist(lx0, ly0, acx, acy)
            d_b_center = dist(lx1, ly1, acx, acy)
            if d_a_center < leaf_tol:
                ox, oy = lx1, ly1  # other end
            elif d_b_center < leaf_tol:
                ox, oy = lx0, ly0
            else:
                continue
            # other endpoint near p0 or p3?
            if (dist(ox, oy, p0[0], p0[1]) < leaf_tol or
                    dist(ox, oy, p3[0], p3[1]) < leaf_tol):
                leaf_found = True
                break
        if not leaf_found:
            continue

        # Check 4: arc center near a wall stroke (within ~5 PDF pts)
        if not _point_near_any_seg(acx, acy, wall_segs, max_d=5.0):
            continue

        door_arcs.append((acx, acy, ar, p0, p3))

    # Group arcs by center
    arc_centers = []
    for (acx, acy, ar, p0, p3) in door_arcs:
        merged = False
        for i, (ecx, ecy, er, cnt, arcs) in enumerate(arc_centers):
            if dist(acx, acy, ecx, ecy) < 8.0 and abs(ar - er) / max(ar, er) < 0.3:
                arc_centers[i] = (ecx, ecy, er, cnt + 1, arcs + [(p0, p3)])
                merged = True
                break
        if not merged:
            arc_centers.append((acx, acy, ar, 1, [(p0, p3)]))

    # === Step 3: Erase door sweep areas ===
    for (acx, acy, ar, cnt, arcs) in arc_centers:
        px_cx = int(acx * scale)
        px_cy = int(acy * scale)
        px_r = int(ar * scale) + 2  # small margin; wall_thickness was too aggressive

        for (p0, p3) in arcs:
            ax, ay = int(p0[0] * scale), int(p0[1] * scale)
            bx, by = int(p3[0] * scale), int(p3[1] * scale)

            # Fill the pie-slice sector with passable space
            poly_pts = [(px_cx, px_cy), (ax, ay)]
            angle0 = math.atan2(ay - px_cy, ax - px_cx)
            angle1 = math.atan2(by - px_cy, bx - px_cx)
            da = angle1 - angle0
            if da > math.pi: da -= 2 * math.pi
            if da < -math.pi: da += 2 * math.pi
            for step in range(1, 20):
                t = step / 20.0
                a = angle0 + t * da
                sx = int(px_cx + math.cos(a) * px_r)
                sy = int(px_cy + math.sin(a) * px_r)
                poly_pts.append((sx, sy))
            poly_pts.append((bx, by))
            pts_arr = np.array(poly_pts, dtype=np.int32)
            cv2.fillPoly(grid, [pts_arr], 255)

            # Erase door leaf lines
            erase_t = wall_thickness + 2
            cv2.line(grid, (px_cx, px_cy), (ax, ay), 255, erase_t)
            cv2.line(grid, (px_cx, px_cy), (bx, by), 255, erase_t)

    # Apply crop boundaries
    grid[:crop_top, :] = 0
    grid[crop_bottom:, :] = 0
    grid[:, :crop_left] = 0
    grid[:, crop_right:] = 0

    # Flood fill exterior
    grid = _flood_fill_exterior(grid, crop_top, crop_bottom, crop_left, crop_right)

    return grid, scale


def _erase_annotation_lines(grid, page, scale, w, h, min_seg_len, wall_thickness=7):
    """Erase annotation/dimension lines from the rasterized grid.

    Annotation lines are typically:
    - Very long (span significant portion of the building)
    - Thin (single-pixel after rasterization)
    - Isolated (not part of the wall network forming enclosed rooms)
    - Often perfectly horizontal or vertical grid lines

    We detect these by looking at vector line segments and checking:
    1. Lines longer than a threshold (e.g., 200 PDF points = ~60% of page)
    2. Lines that are not near wall junctions (isolated)
    """
    pw, ph = page.rect.width, page.rect.height

    # Collect all line segments with their lengths
    segments = []
    for path in page.get_drawings():
        for item in path.get("items", []):
            if item[0] == "l":
                x0, y0 = item[1].x, item[1].y
                x1, y1 = item[2].x, item[2].y
                seg_len = math.hypot(x1 - x0, y1 - y0)
                if seg_len >= min_seg_len:
                    segments.append((x0, y0, x1, y1, seg_len))

    if not segments:
        return

    # Compute length statistics to identify outliers
    lengths = [s[4] for s in segments]
    median_len = sorted(lengths)[len(lengths) // 2]

    # Annotation lines are typically much longer than wall segments
    # Wall segments are usually < 50 PDF points, annotation/grid lines > 150
    long_threshold = max(150, median_len * 4)

    for (x0, y0, x1, y1, seg_len) in segments:
        if seg_len < long_threshold:
            continue

        # Check if this line is nearly horizontal or vertical (grid/dimension lines)
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        is_horiz = dy < 2.0 and dx > long_threshold
        is_vert = dx < 2.0 and dy > long_threshold

        if not (is_horiz or is_vert):
            continue  # diagonal long lines might be structural

        # Erase this line from the grid
        px0, py0 = int(x0 * scale), int(y0 * scale)
        px1, py1 = int(x1 * scale), int(y1 * scale)
        cv2.line(grid, (px0, py0), (px1, py1), 255, wall_thickness + 4)

    # Also detect and erase thin isolated lines using connected components
    # on the wall mask: components that are very thin (height or width = 1-3 pixels)
    # and very long are likely annotation lines
    wall_mask = cv2.bitwise_not(grid)
    num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(wall_mask)

    for label in range(1, num_labels):
        comp_w = stats[label, cv2.CC_STAT_WIDTH]
        comp_h = stats[label, cv2.CC_STAT_HEIGHT]
        area = stats[label, cv2.CC_STAT_AREA]

        # Skip components that aren't thin lines
        if comp_w < 5 and comp_h < 5:
            continue

        # Check aspect ratio: very elongated = likely annotation line
        aspect = max(comp_w, comp_h) / max(min(comp_w, comp_h), 1)

        # Thin line: one dimension is very small (1-5 px), other is very large (>200px)
        thin_dim = min(comp_w, comp_h)
        long_dim = max(comp_w, comp_h)

        if thin_dim <= 5 and long_dim > 200 and aspect > 40:
            # Very thin, very long, very elongated — likely an annotation line
            # But verify it's isolated: check that removing it doesn't break room walls
            # by checking that it's not connected to thick wall structures
            # Simple check: area should be proportional to length (thin line)
            expected_area = long_dim * thin_dim
            if area < expected_area * 1.5:  # confirms it's just a line, not a wall branch
                grid[labels == label] = 255

# ── Phase 2: Line-of-Sight ───────────────────────────────────────────────────

def has_line_of_sight(grid, ax, ay, bx, by, scale, pw, ph):
    """Check if a straight line between two normalized-coordinate points
    is clear of walls in the occupancy grid.
    Uses Bresenham-style pixel-by-pixel checking for zero misses."""
    px1, py1 = int(ax * pw * scale), int(ay * ph * scale)
    px2, py2 = int(bx * pw * scale), int(by * ph * scale)
    return _los_pixels(grid, px1, py1, px2, py2)


def _los_pixels(grid, px1, py1, px2, py2):
    """Check line-of-sight between two pixel coordinates.
    Checks EVERY pixel along the line (Bresenham) — no sampling gaps.
    Also checks diagonal neighbors to prevent corner-cutting through
    1px-wide walls."""
    h, w = grid.shape
    dx = abs(px2 - px1)
    dy = abs(py2 - py1)
    sx = 1 if px1 < px2 else -1
    sy = 1 if py1 < py2 else -1
    err = dx - dy
    x, y = px1, py1

    while True:
        if not (0 <= y < h and 0 <= x < w):
            return False
        if grid[y, x] == 0:
            return False
        if x == px2 and y == py2:
            break
        e2 = 2 * err
        step_x = e2 > -dy
        step_y = e2 < dx
        if step_x and step_y:
            # Diagonal step — check both adjacent pixels to prevent
            # cutting through a 1px wall corner
            if (0 <= y + sy < h and 0 <= x < w and grid[y + sy, x] == 0 and
                0 <= y < h and 0 <= x + sx < w and grid[y, x + sx] == 0):
                return False
        if step_x:
            err -= dy
            x += sx
        if step_y:
            err += dx
            y += sy
    return True

# ── Phase 3: Hallway Skeleton Extraction ─────────────────────────────────────

def _morphological_thin(binary):
    """Zhang-Suen-style thinning using OpenCV morphological operations.
    Input: binary image (255=foreground). Output: skeleton (255=skeleton, 0=bg)."""
    img = (binary > 0).astype(np.uint8)
    skeleton = np.zeros_like(img)
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    while True:
        eroded = cv2.erode(img, element)
        opened = cv2.dilate(eroded, element)
        temp = img - opened
        skeleton = cv2.bitwise_or(skeleton, temp)
        img = eroded.copy()
        if cv2.countNonZero(img) == 0:
            break
    return skeleton * 255

def _seal_dash_gaps(grid):
    """Seal dashed-wall gaps with directional morphological closing on wall mask.

    Dashed walls have 3-5pt gaps = 9-15px at scale=3. We close wall segments
    along horizontal and vertical directions separately to bridge dash gaps.
    Door openings are perpendicular to their wall, so directional closing
    along the wall direction bridges dashes without sealing doors.

    Works on the wall mask (inverted grid) so closing expands wall segments.
    """
    walls = cv2.bitwise_not(grid)  # walls=255, passable=0

    # Horizontal closing: bridges horizontal dashed wall gaps
    h_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 1))
    walls_h = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, h_kernel)

    # Vertical closing: bridges vertical dashed wall gaps
    v_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 21))
    walls_v = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, v_kernel)

    # Intersection: pixel is wall only if BOTH directions agree it's wall
    # This preserves door openings (sealed in one direction but not the other)
    walls_sealed = np.minimum(walls_h, walls_v)

    return cv2.bitwise_not(walls_sealed)


def _flood_fill_exterior(grid, crop_top=None, crop_bottom=None,
                          crop_left=None, crop_right=None):
    """Mark exterior (outside building) as walls by flood-filling from crop boundary.

    Uses aggressive wall dilation to seal building doors/gaps, then flood fills
    from the crop boundary inward. Any region reachable from outside the building
    on the sealed grid is marked as exterior on the original grid.
    """
    h, w = grid.shape

    # Default crop boundaries if not provided
    if crop_top is None:
        crop_top = int(h * 0.10)
    if crop_bottom is None:
        crop_bottom = int(h * 0.82)
    if crop_left is None:
        crop_left = int(w * 0.10)
    if crop_right is None:
        crop_right = int(w * 0.90)

    # Aggressive isotropic wall dilation to seal doors for flood fill
    walls = cv2.bitwise_not(grid)
    dilate_kernel = np.ones((25, 25), np.uint8)
    walls_sealed = cv2.dilate(walls, dilate_kernel, iterations=4)
    sealed = cv2.bitwise_not(walls_sealed)

    # Flood fill from crop boundary (where exterior meets the drawing area)
    # The crop region is already black, so we start just inside the crop edge
    before = sealed.copy()
    mask = np.zeros((h + 2, w + 2), dtype=np.uint8)

    # Top crop boundary
    for x in range(crop_left, crop_right):
        if sealed[crop_top, x] == 255:
            cv2.floodFill(sealed, mask, (x, crop_top), 0)
    # Bottom crop boundary
    for x in range(crop_left, crop_right):
        if sealed[crop_bottom - 1, x] == 255:
            cv2.floodFill(sealed, mask, (x, crop_bottom - 1), 0)
    # Left crop boundary
    for y in range(crop_top, crop_bottom):
        if sealed[y, crop_left] == 255:
            cv2.floodFill(sealed, mask, (crop_left, y), 0)
    # Right crop boundary
    for y in range(crop_top, crop_bottom):
        if sealed[y, crop_right - 1] == 255:
            cv2.floodFill(sealed, mask, (crop_right - 1, y), 0)

    # Exterior = pixels that were passable BEFORE fill but wall AFTER (flood-filled)
    exterior_mask = (before == 255) & (sealed == 0)

    # Grow the exterior mask to catch thin strips between building walls
    # and the flood-filled region (these strips are too narrow to survive dilation)
    ext_grow = cv2.dilate(exterior_mask.astype(np.uint8),
                          np.ones((15, 15), np.uint8), iterations=2)
    # Extended exterior: passable in original grid AND adjacent to known exterior
    # But only apply where distance from wall is large (not inside rooms/corridors)
    dist_from_wall = cv2.distanceTransform(grid, cv2.DIST_L2, 5)
    extended_exterior = (ext_grow > 0) & (grid > 0) & (dist_from_wall > 20)
    exterior_mask = exterior_mask | extended_exterior

    result = grid.copy()
    result[exterior_mask] = 0

    return result

def extract_hallway_skeleton(grid, min_half_width=8, max_half_width=55,
                              min_aspect_ratio=1.5):
    """Extract hallway centerline skeleton from occupancy grid.

    Uses a band-pass distance filter: keeps regions where the distance from
    walls is between min_half_width and max_half_width. This automatically
    excludes large rooms (too wide) and exterior space (too wide), while
    keeping corridor-width passages.

    Optionally also tries flood-fill exterior removal as a supplementary step.

    Args:
        grid: binary occupancy grid (255=passable, 0=wall)
        min_half_width: minimum distance from wall (pixels) to be corridor center
        max_half_width: maximum distance from wall (pixels) — excludes large rooms
        min_aspect_ratio: minimum bounding-box aspect ratio to count as hallway

    Returns:
        skeleton: binary image of hallway centerlines
        dist_map: distance transform
    """
    # Flood-fill exterior (uses aggressive dilation internally to seal dashed walls)
    interior = _flood_fill_exterior(grid)

    # Seal dash gaps in the interior-only grid for accurate distance transform
    sealed_interior = _seal_dash_gaps(interior)
    # Re-apply exterior mask: dash sealing's dilation can leak passable pixels
    # back into the exterior, so force exterior pixels to remain walls
    sealed_interior[interior == 0] = 0
    dist_map = cv2.distanceTransform(sealed_interior, cv2.DIST_L2, 5)

    # Band-pass filter: keep corridor-width spaces only
    corridor_mask = ((dist_map > min_half_width) &
                     (dist_map < max_half_width)).astype(np.uint8) * 255

    if cv2.countNonZero(corridor_mask) == 0:
        return np.zeros_like(grid), dist_map

    # Filter connected components: remove tiny noise and prefer elongated shapes
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(corridor_mask)
    hallway_mask = np.zeros_like(corridor_mask)

    for label in range(1, num_labels):
        w_comp = stats[label, cv2.CC_STAT_WIDTH]
        h_comp = stats[label, cv2.CC_STAT_HEIGHT]
        area = stats[label, cv2.CC_STAT_AREA]

        # Skip tiny noise
        if area < 30:
            continue

        # Aspect ratio of bounding box
        aspect = max(w_comp, h_comp) / max(min(w_comp, h_comp), 1)

        # Keep elongated components (corridors) or small transition areas
        if aspect >= min_aspect_ratio or area < 300:
            hallway_mask[labels == label] = 255

    if cv2.countNonZero(hallway_mask) == 0:
        return np.zeros_like(grid), dist_map

    # Skeletonize to get 1px-wide centerlines
    skeleton = _morphological_thin(hallway_mask)

    return skeleton, dist_map

def sample_skeleton_nodes(skeleton, floor_id, scale, pw, ph, spacing=50,
                          room_nodes=None, room_suppress_r=0.04):
    """Sample hallway nodes along a skeleton image at regular intervals.

    Also detects junctions (3+ skeleton neighbors) and endpoints.
    Suppresses nodes that fall too close to room nodes (inside rooms).

    Args:
        skeleton: binary skeleton image
        floor_id: floor identifier
        scale: render scale factor
        pw, ph: page width/height in PDF points
        spacing: pixel spacing between sampled nodes
        room_nodes: list of room Node objects (to suppress in-room skeleton segments)
        room_suppress_r: normalized radius to suppress skeleton near room centers

    Returns:
        list of (Node, adjacency_list_indices) for connectivity
    """
    if cv2.countNonZero(skeleton) == 0:
        return []

    # Find all skeleton pixels
    skel_points = np.column_stack(np.where(skeleton > 0))  # (y, x) pairs

    if len(skel_points) == 0:
        return []

    # Classify each skeleton pixel by its neighborhood
    # junction = 3+ neighbors, endpoint = 1 neighbor, normal = 2 neighbors
    h, w = skeleton.shape
    junction_pts = []
    endpoint_pts = []

    for (sy, sx) in skel_points:
        count = 0
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == 0 and dx == 0:
                    continue
                ny, nx = sy + dy, sx + dx
                if 0 <= ny < h and 0 <= nx < w and skeleton[ny, nx] > 0:
                    count += 1
        if count >= 3:
            junction_pts.append((sy, sx))
        elif count == 1:
            endpoint_pts.append((sy, sx))

    # Always place nodes at junctions and endpoints
    key_points = []
    for (sy, sx) in junction_pts:
        key_points.append((sx / (pw * scale), sy / (ph * scale)))
    for (sy, sx) in endpoint_pts:
        key_points.append((sx / (pw * scale), sy / (ph * scale)))

    # Sample additional points along skeleton at regular intervals
    # Use connected components to trace skeleton paths
    num_labels, labels = cv2.connectedComponents(skeleton)
    for label in range(1, num_labels):
        component = np.column_stack(np.where(labels == label))  # (y, x)
        if len(component) < spacing:
            # Small component: just place one node at centroid
            cy = component[:, 0].mean()
            cx = component[:, 1].mean()
            key_points.append((cx / (pw * scale), cy / (ph * scale)))
        else:
            # Sample along the component at regular intervals
            # Sort by position to approximate path order
            # Use a greedy nearest-neighbor walk from one endpoint
            start_idx = 0
            # Try to find an endpoint in this component
            for (ey, ex) in endpoint_pts:
                if labels[ey, ex] == label:
                    # Find this point in component
                    dists = np.sqrt((component[:, 0] - ey)**2 + (component[:, 1] - ex)**2)
                    start_idx = np.argmin(dists)
                    break

            # Greedy walk
            visited = np.zeros(len(component), dtype=bool)
            order = [start_idx]
            visited[start_idx] = True
            for _ in range(len(component) - 1):
                cur = order[-1]
                cy, cx = component[cur]
                dists = np.sqrt((component[:, 0] - cy)**2 + (component[:, 1] - cx)**2)
                dists[visited] = 1e9
                nxt = np.argmin(dists)
                if dists[nxt] > 10:  # disconnected, stop
                    break
                order.append(nxt)
                visited[nxt] = True

            # Sample at spacing intervals along the walk
            accumulated = 0.0
            for i in range(1, len(order)):
                py0, px0 = component[order[i-1]]
                py1, px1 = component[order[i]]
                step = math.hypot(px1 - px0, py1 - py0)
                accumulated += step
                if accumulated >= spacing:
                    key_points.append((px1 / (pw * scale), py1 / (ph * scale)))
                    accumulated = 0.0

    # Deduplicate: merge points within spacing/2 pixels (normalized)
    dedup_r = (spacing / 2) / (pw * scale)
    unique_pts = []
    for pt in key_points:
        if not any(dist(pt[0], pt[1], u[0], u[1]) < dedup_r for u in unique_pts):
            unique_pts.append(pt)

    # Suppress points too close to room nodes (likely inside rooms, not hallways)
    if room_nodes:
        filtered = []
        for (nx, ny) in unique_pts:
            in_room = False
            for rn in room_nodes:
                if dist(nx, ny, rn.x, rn.y) < room_suppress_r:
                    in_room = True
                    break
            if not in_room:
                filtered.append((nx, ny))
        unique_pts = filtered

    # Create Node objects
    nodes = []
    for (nx, ny) in unique_pts:
        nodes.append(Node(uid(), floor_id, nx, ny, '', 'hallway'))

    return nodes

# ── door arc detection (from vector paths) ────────────────────────────────────

def line_intersect(px, py, dx, dy, qx, qy, ex, ey):
    det = dx * (-ey) - dy * (-ex)
    if abs(det) < 1e-9:
        return None
    t = ((qx - px) * (-ey) - (qy - py) * (-ex)) / det
    return px + t * dx, py + t * dy

def is_quarter_circle(p0, p1, p2, p3, tol=0.25):
    """Check if cubic Bezier approximates a 90 arc (door swing)."""
    t0x, t0y = p1[0]-p0[0], p1[1]-p0[1]
    t3x, t3y = p3[0]-p2[0], p3[1]-p2[1]
    n0x, n0y = -t0y, t0x
    n3x, n3y = -t3y, t3x

    res = line_intersect(p0[0], p0[1], n0x, n0y, p3[0], p3[1], n3x, n3y)
    if res is None:
        return False, 0, 0, 0
    cx, cy = res

    r0 = dist(p0[0], p0[1], cx, cy)
    r3 = dist(p3[0], p3[1], cx, cy)
    if r0 < 4 or r3 < 4:
        return False, 0, 0, 0
    if abs(r0 - r3) / r0 > tol:
        return False, 0, 0, 0

    r = (r0 + r3) / 2
    v0x, v0y = p0[0]-cx, p0[1]-cy
    v3x, v3y = p3[0]-cx, p3[1]-cy
    cos_a = max(-1.0, min(1.0, (v0x*v3x + v0y*v3y) / (r * r)))
    if abs(math.acos(cos_a) - math.pi/2) > tol * math.pi/2:
        return False, 0, 0, 0

    k0 = math.hypot(t0x, t0y) / r
    k3 = math.hypot(t3x, t3y) / r
    if abs(k0 - 0.5523) > tol or abs(k3 - 0.5523) > tol:
        return False, 0, 0, 0

    return True, cx, cy, r

def extract_door_pivots(page, pw, ph, min_r=8, max_r=70):
    """Detect door-swing arcs from vector Bezier curves. Returns [(nx, ny, nr)].

    Filters out full circles (pillars/columns) by counting how many quarter-arcs
    share the same center point. Doors have 1 arc, pillars have 3-4.
    """
    # Collect all quarter-circle arc centers
    raw_arcs = []
    for path in page.get_drawings():
        for item in path.get("items", []):
            if item[0] != "c":
                continue
            p0 = (item[1].x, item[1].y)
            p1 = (item[2].x, item[2].y)
            p2 = (item[3].x, item[3].y)
            p3 = (item[4].x, item[4].y)
            ok, cx, cy, r = is_quarter_circle(p0, p1, p2, p3)
            if ok and min_r <= r <= max_r:
                raw_arcs.append((cx, cy, r))

    # Count arcs per center point. Pillars = 3-4 arcs (full circle),
    # doors = 1 arc (quarter circle swing)
    MERGE_TOL = 3.0  # PDF points — arcs from same circle share center within this
    centers = []  # list of (cx, cy, r, count)
    for (cx, cy, r) in raw_arcs:
        merged = False
        for i, (ecx, ecy, er, cnt) in enumerate(centers):
            if dist(cx, cy, ecx, ecy) < MERGE_TOL and abs(r - er) / max(r, er) < 0.2:
                # Same center — merge and increment count
                centers[i] = (ecx, ecy, er, cnt + 1)
                merged = True
                break
        if not merged:
            centers.append((cx, cy, r, 1))

    # Keep only single-arc centers (doors), discard multi-arc centers (pillars)
    pivots = []
    for (cx, cy, r, cnt) in centers:
        if cnt <= 2:  # doors have 1-2 arcs, pillars have 3-4
            pivots.append((cx / pw, cy / ph, r / pw))

    out = []
    for p in pivots:
        if not any(dist(p[0], p[1], q[0], q[1]) < 0.008 for q in out):
            out.append(p)
    return out

# ── OCR-based room label extraction ──────────────────────────────────────────

# Room number pattern: N.NNN or N.NNNA (floor digit, dot, 3+ digits, optional letter)
ROOM_RE = re.compile(r'^\d\.\d{3,}[A-Za-z]?$')
# Also match without dot: NNNN or NNNNA (4-5 digits, first = floor number)
ROOM_NODOT_RE = re.compile(r'^(\d)(\d{3,4})([A-Za-z])?$')

# Vertical transport keywords
STAIR_RE = re.compile(r'(?i)^(stair|stairs|stairwell|stw|s\d+)$')
ELEV_RE = re.compile(r'(?i)^(elev|elevator|elevat|elv|e\d+|lift)$')

def _clean_ocr_text(text):
    """Normalize OCR output for room number matching."""
    text = text.strip().replace(',', '.').replace(' ', '').replace('|', '')
    # Fix common OCR substitutions
    text = text.replace('-', '.').replace('~', '.').replace(';', '.')

    # If already has dot in right place, handle suffix normalization
    if re.match(r'^\d\.\d{4,}$', text):
        base = text[:5]
        suffix = text[5:]
        if len(suffix) == 1:
            digit_to_letter = {'4': 'A', '8': 'B', '0': 'D'}
            if suffix in digit_to_letter:
                text = base + digit_to_letter[suffix]
            else:
                text = base
        else:
            text = base
        return text

    # No dot: try inserting one after first digit (e.g. "4204" → "4.204")
    m = ROOM_NODOT_RE.match(text)
    if m:
        floor_d, room_d, suffix = m.group(1), m.group(2), m.group(3) or ''
        text = f"{floor_d}.{room_d}{suffix}"

    return text

def extract_rooms_ocr(page, floor_id, floor_num, reader):
    """OCR to extract room labels from a rendered floor plan page.
    Returns (list of Node objects, list of all_texts as (text, nx, ny) tuples)."""
    pw, ph = page.rect.width, page.rect.height
    SCALE = 4  # 4x is a good balance of speed vs accuracy

    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    kernel = np.ones((2, 2), np.uint8)
    thick = cv2.erode(binary, kernel, iterations=1)

    raw_candidates = {}  # text -> (nx, ny, conf)
    all_texts = []  # all OCR detections for VT detection

    def collect(results):
        for bbox, text, conf in results:
            if conf < 0.15:
                continue
            cx = sum(p[0] for p in bbox) / 4 / pix.width
            cy = sum(p[1] for p in bbox) / 4 / pix.height
            raw_text = text.strip()
            all_texts.append((raw_text, cx, cy))
            text = _clean_ocr_text(raw_text)
            if not ROOM_RE.match(text):
                continue
            if not text.startswith(str(floor_num)):
                continue
            if text not in raw_candidates or raw_candidates[text][2] < conf:
                raw_candidates[text] = (cx, cy, conf)

    # Pass 1: Raw grayscale with mag_ratio=3 (best single pass)
    collect(reader.readtext(gray, detail=1, text_threshold=0.25, low_text=0.25,
                             mag_ratio=3, paragraph=False))
    # Pass 2: Thickened binary with digit allowlist
    collect(reader.readtext(thick, detail=1, text_threshold=0.2, low_text=0.2,
                             mag_ratio=3, paragraph=False,
                             allowlist='0123456789.ABCDEabcde'))
    # Pass 3: Higher mag_ratio for small labels, very low thresholds
    collect(reader.readtext(gray, detail=1, text_threshold=0.15, low_text=0.15,
                             mag_ratio=5, paragraph=False,
                             allowlist='0123456789.ABCDEabcde'))

    # Deduplicate by position
    final = {}
    for text, (nx, ny, conf) in raw_candidates.items():
        merged = False
        for existing_text in list(final.keys()):
            ex, ey, ec = final[existing_text]
            if dist(nx, ny, ex, ey) < 0.015:
                if conf > ec:
                    del final[existing_text]
                    final[text] = (nx, ny, conf)
                merged = True
                break
        if not merged:
            final[text] = (nx, ny, conf)

    nodes = []
    for text, (nx, ny, conf) in final.items():
        nodes.append(Node(uid(), floor_id, nx, ny, text, 'room'))
    return nodes, all_texts

def extract_rooms_tesseract(page, floor_id, floor_num, scale=5):
    """Extract room labels using Tesseract OCR. Returns list of Node objects."""
    import pytesseract

    pw, ph = page.rect.width, page.rect.height
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        gray = cv2.cvtColor(img, cv2.COLOR_RGBA2GRAY)
    elif pix.n == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    else:
        gray = img

    # Preprocess: threshold + thicken strokes for better OCR
    _, binary = cv2.threshold(gray, 180, 255, cv2.THRESH_BINARY)
    kernel = np.ones((2, 2), np.uint8)
    thick = cv2.erode(binary, kernel, iterations=1)

    raw_candidates = {}

    def collect_tesseract(image):
        data = pytesseract.image_to_data(image, config='--psm 11 --oem 3',
                                          output_type=pytesseract.Output.DICT)
        n_boxes = len(data['text'])
        for i in range(n_boxes):
            text = data['text'][i].strip()
            conf = int(data['conf'][i]) if data['conf'][i] != '-1' else 0
            if conf < 15:
                continue
            text = _clean_ocr_text(text)
            if not ROOM_RE.match(text):
                continue
            if not text.startswith(str(floor_num)):
                continue
            x = data['left'][i] + data['width'][i] / 2
            y = data['top'][i] + data['height'][i] / 2
            nx = x / pix.width
            ny = y / pix.height
            norm_conf = conf / 100.0
            if text not in raw_candidates or raw_candidates[text][2] < norm_conf:
                raw_candidates[text] = (nx, ny, norm_conf)

    collect_tesseract(thick)
    collect_tesseract(gray)

    # Deduplicate by position
    final = {}
    for text, (nx, ny, conf) in raw_candidates.items():
        merged = False
        for existing_text in list(final.keys()):
            ex, ey, ec = final[existing_text]
            if dist(nx, ny, ex, ey) < 0.015:
                if conf > ec:
                    del final[existing_text]
                    final[text] = (nx, ny, conf)
                merged = True
                break
        if not merged:
            final[text] = (nx, ny, conf)

    nodes = []
    for text, (nx, ny, conf) in final.items():
        nodes.append(Node(uid(), floor_id, nx, ny, text, 'room'))
    return nodes

def merge_ocr_results(nodes_a, nodes_b):
    """Merge two lists of room nodes, keeping higher-confidence detections
    and deduplicating by position."""
    all_nodes = list(nodes_a)
    for nb in nodes_b:
        duplicate = False
        for na in all_nodes:
            if dist(na.x, na.y, nb.x, nb.y) < 0.015:
                duplicate = True
                # Keep whichever has a label (both should, but just in case)
                if not na.label and nb.label:
                    na.label = nb.label
                break
            if na.label == nb.label:
                duplicate = True
                break
        if not duplicate:
            all_nodes.append(nb)
    return all_nodes

# ── check for native PDF text layer ──────────────────────────────────────────

def extract_rooms_text(page, pw, ph, floor_id, floor_num):
    """Try extracting room labels from PDF text layer (for PDFs that have one)."""
    nodes = []
    seen = set()
    for w in page.get_text("words"):
        x0, y0, x1, y1, text = w[0], w[1], w[2], w[3], w[4].strip()
        if not ROOM_RE.match(text):
            continue
        if not text.startswith(str(floor_num)):
            continue
        if text in seen:
            continue
        seen.add(text)
        cx = (x0 + x1) / 2 / pw
        cy = (y0 + y1) / 2 / ph
        nodes.append(Node(uid(), floor_id, cx, cy, text, 'room'))
    return nodes

# ── Phase 5: Stairwell / Elevator Detection ──────────────────────────────────

def detect_vertical_transport_ocr(page, floor_id, floor_num, ocr_texts=None):
    """Scan already-collected OCR text results for stairwell/elevator labels.
    ocr_texts is a list of (text, nx, ny) tuples from the OCR pass.
    Returns list of Node objects with type='stairwell' or 'elevator'."""
    nodes = []
    if not ocr_texts:
        return nodes

    seen_pos = []
    for text, nx, ny in ocr_texts:
        ntype = None
        if STAIR_RE.match(text):
            ntype = 'stairwell'
        elif ELEV_RE.match(text):
            ntype = 'elevator'

        if ntype:
            if not any(dist(nx, ny, sx, sy) < 0.02 for sx, sy in seen_pos):
                seen_pos.append((nx, ny))
                nodes.append(Node(uid(), floor_id, nx, ny, text, ntype))

    return nodes

def detect_vertical_transport_crossfloor(all_floor_nodes, floors, grid_per_floor,
                                          scale, pw, ph):
    """Heuristic: find regions at the same XY across multiple floors that lack room labels.
    These are likely stairwells or elevator shafts.
    Returns list of new Node objects to add."""
    if len(floors) < 2:
        return []

    # For each floor, find small enclosed regions in the occupancy grid
    # that appear at the same position on 3+ floors
    # This is a simplified version: look for room-less areas near door pivots
    # that repeat across floors
    return []  # Placeholder - OCR-based detection is primary

# ── Phase 4: Wall-Aware Edge Building ────────────────────────────────────────

def erase_text_from_grid(grid, rooms, ocr_texts, scale, pw, ph, margin=5):
    """Erase known text regions from the occupancy grid.

    Uses OCR-detected text positions to punch holes in the grid where
    text characters appear. This prevents text from being treated as walls.

    Args:
        grid: binary occupancy grid (modified in place)
        rooms: list of Node objects with known positions
        ocr_texts: list of (text, nx, ny) tuples from OCR
        scale: render scale
        pw, ph: page dimensions in PDF points
        margin: extra pixels around each text region to erase
    """
    h, w = grid.shape

    # Erase at room label positions (most reliable — we know exactly where they are)
    for node in rooms:
        if not node.label:
            continue
        px = int(node.x * pw * scale)
        py = int(node.y * ph * scale)
        # Room labels are typically ~30x10px at scale=3
        # Erase a rectangle around the label
        label_w = max(20, len(node.label) * 8)  # rough estimate of text width
        label_h = 14
        x0 = max(0, px - label_w // 2 - margin)
        y0 = max(0, py - label_h // 2 - margin)
        x1 = min(w, px + label_w // 2 + margin)
        y1 = min(h, py + label_h // 2 + margin)
        grid[y0:y1, x0:x1] = 255  # make passable

    # Also erase at all OCR detection positions
    for text, nx, ny in ocr_texts:
        px = int(nx * pw * scale)
        py = int(ny * ph * scale)
        text_w = max(15, len(text) * 7)
        text_h = 12
        x0 = max(0, px - text_w // 2 - margin)
        y0 = max(0, py - text_h // 2 - margin)
        x1 = min(w, px + text_w // 2 + margin)
        y1 = min(h, py + text_h // 2 + margin)
        grid[y0:y1, x0:x1] = 255


def block_exterior_from_rooms(grid, room_nodes, scale, pw, ph):
    """Block exterior space using convex hull of room positions.

    The convex hull of all detected room positions defines the building footprint.
    Any passable pixel outside the hull (with generous margin) is exterior.
    This is more robust than flood-fill approaches because it doesn't require
    sealing the building envelope — it works even with large openings.
    """
    h, w = grid.shape
    if len(room_nodes) < 3:
        return grid

    # Compute convex hull of room positions in pixel space
    pts = np.array([(int(n.x * pw * scale), int(n.y * ph * scale))
                    for n in room_nodes], dtype=np.int32)
    hull = cv2.convexHull(pts)

    # Create interior mask from convex hull
    interior_mask = np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(interior_mask, [hull], 255)

    # Add generous margin around hull to include corridors and rooms on perimeter
    # ~50px margin at scale=3 ≈ ~17 PDF points ≈ ~1.5 feet at 1/32" scale
    interior_mask = cv2.dilate(interior_mask, np.ones((51, 51), np.uint8), iterations=2)

    # Block any passable pixel outside the dilated convex hull
    result = grid.copy()
    result[(grid > 0) & (interior_mask == 0)] = 0
    return result


def _snap_to_passable(grid, px, py, max_search=80):
    """Snap a pixel coordinate to the nearest passable pixel on the grid."""
    h, w = grid.shape
    px = max(0, min(w - 1, px))
    py = max(0, min(h - 1, py))
    if grid[py, px] > 0:
        return px, py
    # Spiral outward to find nearest passable pixel
    for r in range(1, max_search):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if abs(dy) != r and abs(dx) != r:
                    continue  # only check perimeter of square
                ny, nx = py + dy, px + dx
                if 0 <= ny < h and 0 <= nx < w and grid[ny, nx] > 0:
                    return nx, ny
    return px, py  # give up, return original


def _rdp_simplify(points, epsilon, grid=None, scale=None, pw=None, ph=None):
    """Ramer-Douglas-Peucker polyline simplification.
    If grid is provided, only collapse points when the straight line has
    clear line-of-sight (doesn't cross walls)."""
    if len(points) <= 2:
        return points

    # Find point farthest from line between first and last
    start, end = np.array(points[0]), np.array(points[-1])
    line_vec = end - start
    line_len = np.linalg.norm(line_vec)

    if line_len < 1e-10:
        return [points[0], points[-1]]

    line_unit = line_vec / line_len
    max_dist = 0
    max_idx = 0
    for i in range(1, len(points) - 1):
        pt = np.array(points[i]) - start
        proj = np.dot(pt, line_unit)
        perp = pt - proj * line_unit
        d = np.linalg.norm(perp)
        if d > max_dist:
            max_dist = d
            max_idx = i

    if max_dist > epsilon:
        left = _rdp_simplify(points[:max_idx + 1], epsilon, grid, scale, pw, ph)
        right = _rdp_simplify(points[max_idx:], epsilon, grid, scale, pw, ph)
        return left[:-1] + right
    else:
        # Before collapsing to straight line, check LOS if grid provided
        if grid is not None:
            ax, ay = points[0]
            bx, by = points[-1]
            if not has_line_of_sight(grid, ax, ay, bx, by, scale, pw, ph):
                # Can't simplify — wall in the way. Split at farthest point.
                if len(points) > 2:
                    mid = len(points) // 2
                    left = _rdp_simplify(points[:mid + 1], epsilon, grid, scale, pw, ph)
                    right = _rdp_simplify(points[mid:], epsilon, grid, scale, pw, ph)
                    return left[:-1] + right
        return [points[0], points[-1]]


def _bfs_path(grid, sx, sy, ex, ey):
    """BFS shortest path between two pixels on the grid.
    Returns list of (px, py) pixel coords, or None if no path exists."""
    from collections import deque
    h, w = grid.shape
    sx, sy = max(0, min(w-1, sx)), max(0, min(h-1, sy))
    ex, ey = max(0, min(w-1, ex)), max(0, min(h-1, ey))

    if grid[sy, sx] == 0:
        sx, sy = _snap_to_passable(grid, sx, sy, max_search=50)
    if grid[ey, ex] == 0:
        ex, ey = _snap_to_passable(grid, ex, ey, max_search=50)

    if sx == ex and sy == ey:
        return [(sx, sy)]

    visited = np.zeros((h, w), dtype=bool)
    pred = np.full((h, w), -1, dtype=np.int64)
    visited[sy, sx] = True
    queue = deque([(sy, sx)])

    while queue:
        cy, cx = queue.popleft()
        if cx == ex and cy == ey:
            # Trace back
            path = []
            py, px = ey, ex
            while pred[py, px] != -1:
                path.append((px, py))
                enc = pred[py, px]
                py, px = int(enc // w), int(enc % w)
            path.append((sx, sy))
            path.reverse()
            return path
        for dy, dx in ((-1,0),(1,0),(0,-1),(0,1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and grid[ny, nx] > 0 and not visited[ny, nx]:
                visited[ny, nx] = True
                pred[ny, nx] = cy * w + cx
                queue.append((ny, nx))
    return None  # No path


def _center_path(path_px, dist_transform, grid, radius=8):
    """Pull path waypoints toward corridor centers using distance transform.

    For each waypoint, search in a small radius for the pixel with the
    highest distance-from-wall value (corridor center) and move toward it.
    Only moves to passable pixels. After centering, validates that each
    segment still has clear LOS — reverts waypoints that break LOS.
    """
    h, w = grid.shape
    centered = []
    for (px, py) in path_px:
        best_val = dist_transform[py, px] if 0 <= py < h and 0 <= px < w else 0
        best_px, best_py = px, py
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                ny, nx = py + dy, px + dx
                if 0 <= ny < h and 0 <= nx < w and grid[ny, nx] > 0:
                    val = dist_transform[ny, nx]
                    if val > best_val:
                        best_val = val
                        best_px, best_py = nx, ny
        centered.append((best_px, best_py))

    # Validate: revert any waypoint that breaks LOS with its neighbors
    for i in range(len(centered)):
        ok = True
        if i > 0:
            ok = ok and _los_pixels(grid, centered[i-1][0], centered[i-1][1],
                                     centered[i][0], centered[i][1])
        if ok and i < len(centered) - 1:
            ok = ok and _los_pixels(grid, centered[i][0], centered[i][1],
                                     centered[i+1][0], centered[i+1][1])
        if not ok:
            centered[i] = path_px[i]  # revert to original

    return centered


def _los_subsample(grid, path_px):
    """Greedily subsample a pixel path keeping only LOS-validated waypoints.
    Each consecutive pair of returned points has clear Bresenham LOS.
    Input path must be pixel-valid (every pixel is passable)."""
    if len(path_px) <= 2:
        return list(path_px)
    result = [path_px[0]]
    i = 0
    while i < len(path_px) - 1:
        # Linear scan from farthest point back to find the farthest visible.
        # Binary search is incorrect here because LOS visibility along a
        # corridor path is NOT monotonic (e.g. L-shaped corridors, doorways).
        best = i + 1
        for j in range(len(path_px) - 1, i, -1):
            if _los_pixels(grid, result[-1][0], result[-1][1],
                           path_px[j][0], path_px[j][1]):
                best = j
                break
        result.append(path_px[best])
        i = best
    return result


def build_floor_edges_bfs(nodes, grid, scale, pw, ph):
    """Build edges using multi-source BFS on the occupancy grid.

    Algorithm:
    1. Erode the grid so paths are forced through corridor centers
    2. Snap each room node to its nearest passable pixel on eroded grid
    3. Multi-source BFS from all nodes with predecessor tracking
    4. Where two nodes' Voronoi regions touch, create an edge
    5. Trace the actual BFS path through corridors for each edge
    6. Simplify paths with RDP and store as polyline waypoints

    Each edge gets a 'path' field: list of [x,y] normalized coords
    that follow corridor centers through doors, never through walls.
    """
    from collections import deque

    h, w = grid.shape
    n_nodes = len(nodes)

    if n_nodes == 0:
        return []

    # No erosion — use original grid so BFS can reach through all doorways.
    # Path centering is handled by _center_path post-processing.
    eroded = grid

    # Distance transform on original grid for path post-processing
    dist_transform = cv2.distanceTransform(grid, cv2.DIST_L2, 5)

    # Map each node to a pixel position, snapped to nearest passable pixel
    # Try eroded grid first; fall back to original if room is fully enclosed
    node_pixels = []
    for node in nodes:
        px = int(node.x * pw * scale)
        py = int(node.y * ph * scale)
        px_e, py_e = _snap_to_passable(eroded, px, py, max_search=100)
        node_pixels.append((px_e, py_e))

    # Multi-source BFS on eroded grid with predecessor tracking
    owner = np.full((h, w), -1, dtype=np.int32)
    dist_grid = np.full((h, w), -1, dtype=np.int32)
    pred = np.full((h, w), -1, dtype=np.int64)

    queue = deque()
    for i, (px, py) in enumerate(node_pixels):
        if owner[py, px] == -1:
            owner[py, px] = i
            dist_grid[py, px] = 0
            pred[py, px] = -1
            queue.append((py, px))

    # 4-connected BFS expansion on eroded grid
    while queue:
        cy, cx = queue.popleft()
        cd = dist_grid[cy, cx]
        co = owner[cy, cx]
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = cy + dy, cx + dx
            if 0 <= ny < h and 0 <= nx < w and eroded[ny, nx] > 0 and owner[ny, nx] == -1:
                owner[ny, nx] = co
                dist_grid[ny, nx] = cd + 1
                pred[ny, nx] = cy * w + cx
                queue.append((ny, nx))

    # Find Voronoi boundaries and record the best meeting point for each pair
    # Store: (min_idx, max_idx) → (total_dist, pixel_y_a, pixel_x_a, pixel_y_b, pixel_x_b)
    edge_candidates = {}

    for y in range(1, h - 1):
        for x in range(1, w - 1):
            o = owner[y, x]
            if o < 0:
                continue
            d = dist_grid[y, x]
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                no = owner[ny, nx]
                if no >= 0 and no != o:
                    pair = (min(o, no), max(o, no))
                    total_d = d + dist_grid[ny, nx]
                    if pair not in edge_candidates or total_d < edge_candidates[pair][0]:
                        # Store the two boundary pixels (one from each side)
                        if o < no:
                            edge_candidates[pair] = (total_d, y, x, ny, nx)
                        else:
                            edge_candidates[pair] = (total_d, ny, nx, y, x)

    def trace_path(py, px):
        """Trace BFS predecessor chain from pixel back to source. Returns [(px, py), ...]."""
        path = []
        while pred[py, px] != -1:
            path.append((px, py))
            encoded = pred[py, px]
            py, px = int(encoded // w), int(encoded % w)
        path.append((px, py))  # source pixel
        path.reverse()
        return path

    # Create edges with traced corridor paths
    edges = []
    for (a, b), (pixel_dist, ya, xa, yb, xb) in edge_candidates.items():
        # Trace path from room A to boundary
        path_a = trace_path(ya, xa)
        # Trace path from room B to boundary
        path_b = trace_path(yb, xb)
        # Combine: path_a goes source_a → boundary, path_b goes source_b → boundary
        # We want: source_a → boundary → source_b
        path_b.reverse()
        full_path_px = path_a + path_b

        # Center the path in corridors. Larger radius pulls waypoints
        # firmly toward corridor centerlines so paths don't hug a wall on
        # one side of the BFS Voronoi boundary.
        full_path_px = _center_path(full_path_px, dist_transform, grid, radius=15)

        # LOS-greedy subsampling — guarantees no Bresenham pixel crosses a wall.
        subsampled_px = _los_subsample(grid, full_path_px)

        # Convert to normalized coords
        simplified = [(px_c / (pw * scale), py_c / (ph * scale))
                      for px_c, py_c in subsampled_px]

        weight = pixel_dist / scale  # PDF points
        edges.append(Edge(uid(), nodes[a].id, nodes[b].id, weight, path=simplified))

    # Find isolated nodes (not reached by BFS)
    connected_ids = set()
    for e in edges:
        connected_ids.add(e.from_id)
        connected_ids.add(e.to_id)

    # Fallback: connect isolated nodes to nearest reachable node via BFS
    for node in nodes:
        if node.id in connected_ids:
            continue
        # Try up to 5 nearest nodes, pick first with a valid BFS path
        candidates = sorted(
            [o for o in nodes if o.id != node.id],
            key=lambda o: dist(node.x, node.y, o.x, o.y)
        )[:5]
        for other in candidates:
            sx = int(node.x * pw * scale)
            sy = int(node.y * ph * scale)
            ex = int(other.x * pw * scale)
            ey = int(other.y * ph * scale)
            bfs_result = _bfs_path(grid, sx, sy, ex, ey)
            if bfs_result:
                # LOS-greedy subsampling — guaranteed wall-free
                sub_px = _los_subsample(grid, bfs_result)
                path_norm = [(px_c / (pw * scale), py_c / (ph * scale))
                             for px_c, py_c in sub_px]
                weight = len(bfs_result) / scale
                edges.append(Edge(uid(), node.id, other.id, weight, path=path_norm))
                connected_ids.add(node.id)
                break

    return edges


def ensure_connected(nodes, edges, grid, scale, pw, ph):
    """Ensure the per-floor graph is fully connected.

    Finds connected components and bridges them with shortest edges,
    using LOS when possible, falling back to direct connections if needed.
    """
    if len(nodes) < 2:
        return edges

    # Build adjacency via Union-Find
    parent = {n.id: n.id for n in nodes}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x
    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for e in edges:
        if e.from_id in parent and e.to_id in parent:
            union(e.from_id, e.to_id)

    # Find connected components
    components = {}
    for n in nodes:
        root = find(n.id)
        components.setdefault(root, []).append(n)

    comp_list = list(components.values())
    if len(comp_list) <= 1:
        return edges

    existing = {(min(e.from_id, e.to_id), max(e.from_id, e.to_id)) for e in edges}

    # Merge components greedily: always bridge the two closest components
    # Use representative nodes (up to 20 per component) to avoid O(n^2) blowup
    while len(comp_list) > 1:
        best_dist = float('inf')
        best_pair = None
        best_ci = best_cj = 0

        for ci in range(len(comp_list)):
            # Sample representative nodes from component
            rep_i = comp_list[ci][:20] if len(comp_list[ci]) > 20 else comp_list[ci]
            for cj in range(ci + 1, len(comp_list)):
                rep_j = comp_list[cj][:20] if len(comp_list[cj]) > 20 else comp_list[cj]
                for a in rep_i:
                    for b in rep_j:
                        d = dist(a.x, a.y, b.x, b.y)
                        if d < best_dist:
                            best_dist = d
                            best_pair = (a, b)
                            best_ci, best_cj = ci, cj

        if best_pair is None:
            break

        a, b = best_pair
        key = (min(a.id, b.id), max(a.id, b.id))
        if key not in existing:
            # Use BFS to find wall-respecting path
            sx = int(a.x * pw * scale)
            sy = int(a.y * ph * scale)
            ex = int(b.x * pw * scale)
            ey = int(b.y * ph * scale)
            bfs_result = _bfs_path(grid, sx, sy, ex, ey)
            if bfs_result:
                sub_px = _los_subsample(grid, bfs_result)
                path_norm = [(px_c / (pw * scale), py_c / (ph * scale))
                             for px_c, py_c in sub_px]
                w_val = len(bfs_result) / scale
                edges.append(Edge(uid(), a.id, b.id, w_val, path=path_norm))
            # If BFS fails, do NOT create a straight-line edge through walls
            existing.add(key)

        # Merge the two components
        merged = comp_list[best_ci] + comp_list[best_cj]
        comp_list = [c for i, c in enumerate(comp_list)
                     if i != best_ci and i != best_cj]
        comp_list.append(merged)

    return edges


# ── inter-floor linking ───────────────────────────────────────────────────────

def link_interfloor(all_nodes, all_edges, floors):
    inter_types = {'stairwell', 'elevator'}
    candidates = [n for n in all_nodes if n.type in inter_types]
    existing = {(e.from_id, e.to_id) for e in all_edges}
    existing |= {(e.to_id, e.from_id) for e in all_edges}

    XY_TOL = 0.035
    floor_idx = {f['id']: i for i, f in enumerate(floors)}
    used = set()
    groups = []

    for n in candidates:
        if n.id in used:
            continue
        group = [n]
        used.add(n.id)
        for m in candidates:
            if m.id in used or m.floor_id == n.floor_id:
                continue
            if dist(n.x, n.y, m.x, m.y) < XY_TOL:
                group.append(m)
                used.add(m.id)
        if len(group) > 1:
            groups.append(group)

    created = 0
    for group in groups:
        group.sort(key=lambda n: floor_idx.get(n.floor_id, 0))
        gname = f"shaft-{group[0].id[:4]}"
        for n in group:
            if not n.group_id:
                n.group_id = gname
        for i in range(len(group) - 1):
            a, b = group[i], group[i + 1]
            if (a.id, b.id) not in existing:
                all_edges.append(Edge(uid(), a.id, b.id, 50, inter_floor=True))
                created += 1
    return created

# ── Phase 7: Debug Visualization ─────────────────────────────────────────────

def save_debug_images(debug_dir, floor_name, page, grid, dist_map, skeleton,
                       nodes, edges, scale, pw, ph):
    """Save debug visualization PNGs for a floor."""
    os.makedirs(debug_dir, exist_ok=True)
    prefix = floor_name.lower().replace(' ', '_')

    # 1. Occupancy grid
    cv2.imwrite(os.path.join(debug_dir, f"{prefix}_occupancy.png"), grid)

    # 2. Distance transform (colorized)
    if dist_map is not None:
        norm = cv2.normalize(dist_map, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
        colored = cv2.applyColorMap(norm, cv2.COLORMAP_JET)
        cv2.imwrite(os.path.join(debug_dir, f"{prefix}_distance.png"), colored)

    # 3. Skeleton overlay
    if skeleton is not None:
        overlay = cv2.cvtColor(grid, cv2.COLOR_GRAY2BGR)
        overlay[skeleton > 0] = (0, 0, 255)  # red skeleton
        cv2.imwrite(os.path.join(debug_dir, f"{prefix}_skeleton.png"), overlay)

    # 4. Final graph overlay
    # Render floor plan at grid scale for background
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
    bg = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, pix.n)
    if pix.n == 4:
        bg = cv2.cvtColor(bg, cv2.COLOR_RGBA2BGR)
    elif pix.n == 3:
        bg = cv2.cvtColor(bg, cv2.COLOR_RGB2BGR)
    else:
        bg = cv2.cvtColor(bg, cv2.COLOR_GRAY2BGR)

    node_map = {n.id: n for n in nodes}

    # Draw edges (using actual corridor paths if available)
    for e in edges:
        color = (255, 100, 100)  # blue for room connections
        if e.inter_floor:
            color = (0, 0, 255)  # red for inter-floor

        if e.path and len(e.path) >= 2:
            # Draw the actual corridor path as a polyline
            pts = [(int(x * pw * scale), int(y * ph * scale)) for x, y in e.path]
            for i in range(len(pts) - 1):
                cv2.line(bg, pts[i], pts[i + 1], color, 2)
        else:
            # Fallback: straight line
            a = node_map.get(e.from_id)
            b = node_map.get(e.to_id)
            if a and b:
                ax, ay = int(a.x * pw * scale), int(a.y * ph * scale)
                bx, by = int(b.x * pw * scale), int(b.y * ph * scale)
                cv2.line(bg, (ax, ay), (bx, by), color, 2)

    # Draw nodes
    for n in nodes:
        px, py = int(n.x * pw * scale), int(n.y * ph * scale)
        if n.type == 'room':
            cv2.circle(bg, (px, py), 6, (0, 200, 0), -1)  # green
            cv2.circle(bg, (px, py), 6, (0, 100, 0), 1)
        elif n.type == 'hallway':
            cv2.circle(bg, (px, py), 4, (200, 200, 0), -1)  # cyan
            cv2.circle(bg, (px, py), 4, (150, 150, 0), 1)
        elif n.type == 'stairwell':
            cv2.circle(bg, (px, py), 8, (0, 0, 255), -1)  # red
            cv2.circle(bg, (px, py), 8, (0, 0, 180), 1)
        elif n.type == 'elevator':
            cv2.circle(bg, (px, py), 8, (255, 0, 255), -1)  # magenta
            cv2.circle(bg, (px, py), 8, (180, 0, 180), 1)

        if n.label:
            cv2.putText(bg, n.label, (px + 8, py - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 0), 2)
            cv2.putText(bg, n.label, (px + 8, py - 4),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.35, (255, 255, 255), 1)

    cv2.imwrite(os.path.join(debug_dir, f"{prefix}_graph.png"), bg)

# ── main ──────────────────────────────────────────────────────────────────────

def _cache_dir(pdf_path):
    """Get cache directory for a PDF."""
    cache_dir = os.path.join(os.path.dirname(os.path.abspath(pdf_path)), '.floorplan_cache')
    os.makedirs(cache_dir, exist_ok=True)
    return cache_dir


def parse_pdf(pdf_path, building_name, ocr_engine='easyocr', render_scale=3,
              debug=False, debug_dir=None):
    # Separate caches: OCR results (slow, stable) vs grids (fast to regenerate)
    cache_dir = _cache_dir(pdf_path)
    h = hashlib.md5(os.path.abspath(pdf_path).encode()).hexdigest()[:12]
    ocr_cache_file = os.path.join(cache_dir, f"{h}_ocr.json")

    ocr_cached = None
    if os.path.exists(ocr_cache_file):
        try:
            with open(ocr_cache_file, 'r', encoding='utf-8') as f:
                raw_cache = json.load(f)
            ocr_cached = {int(k): v for k, v in raw_cache.items()}
            print("  Using cached OCR results (grids regenerated fresh)", flush=True)
        except Exception as e:
            print(f"  Warning: could not load OCR cache: {e}", file=sys.stderr, flush=True)
            ocr_cached = None

    use_tesseract = ocr_engine in ('tesseract', 'both')

    floors = []
    all_nodes = []
    all_edges = []
    ocr_cache_data = {}

    with fitz.open(pdf_path) as doc:
        # Check if PDF has a text layer
        has_text = len(doc[0].get_text("words")) > 0

        reader = None
        if ocr_cached is None and not has_text and ocr_engine in ('easyocr', 'both'):
            import easyocr
            print("  Loading EasyOCR engine...", flush=True)
            reader = easyocr.Reader(['en'], gpu=False, verbose=False)

        if ocr_cached is None and use_tesseract:
            print("  Tesseract OCR enabled")

        for idx in range(len(doc)):
            page = doc[idx]
            pw, ph = page.rect.width, page.rect.height
            fnum = idx + 1
            fid = f"f{idx}"
            fname = f"Floor {fnum}"
            floors.append({"id": fid, "name": fname, "pageIndex": idx})
    
            print(f"  {fname}  ({pw:.0f}x{ph:.0f} pts)", flush=True)
    
            # Always regenerate grid (fast, ~1 second per floor)
            print(f"    Rendering occupancy grid (scale={render_scale})...", flush=True)
            grid, gs = render_occupancy_grid(page, scale=render_scale)
    
            # OCR: use cache if available (slow, ~15 seconds per floor)
            if ocr_cached and idx in ocr_cached:
                c = ocr_cached[idx]
                rooms = [Node(n['id'], n['floor_id'], n['x'], n['y'], n['label'], n['type'],
                             n.get('group_id')) for n in c['rooms']]
                pivots = c['pivots']
                ocr_texts = c.get('ocr_texts', [])
                print(f"    (cached OCR: {len(rooms)} rooms)", flush=True)
            else:
                rooms = []
                ocr_texts = []
                if has_text:
                    rooms = extract_rooms_text(page, pw, ph, fid, fnum)
                else:
                    if reader:
                        print(f"    Running EasyOCR (3 passes)...", flush=True)
                        rooms, ocr_texts = extract_rooms_ocr(page, fid, fnum, reader)
                    if use_tesseract:
                        print(f"    Running Tesseract OCR...", flush=True)
                        tess_rooms = extract_rooms_tesseract(page, fid, fnum)
                        if rooms:
                            rooms = merge_ocr_results(rooms, tess_rooms)
                        else:
                            rooms = tess_rooms
    
                pivots = extract_door_pivots(page, pw, ph)
                ocr_cache_data[idx] = {
                    'rooms': [{'id': r.id, 'floor_id': r.floor_id, 'x': r.x, 'y': r.y,
                               'label': r.label, 'type': r.type, 'group_id': r.group_id}
                              for r in rooms],
                    'pivots': pivots,
                    'ocr_texts': ocr_texts,
                }
    
            # Phase 5: Detect vertical transport (reuses OCR text results)
            vt_nodes = detect_vertical_transport_ocr(page, fid, fnum, ocr_texts=ocr_texts)
            for vt in vt_nodes:
                if not any(dist(vt.x, vt.y, r.x, r.y) < 0.015 for r in rooms):
                    rooms.append(vt)
    
            nodes = rooms
    
            # Erase known text regions from the grid (prevents text = walls)
            erase_text_from_grid(grid, rooms, ocr_texts, gs, pw, ph)
    
            # Block exterior using convex hull (fast)
            if nodes:
                grid = block_exterior_from_rooms(grid, nodes, gs, pw, ph)
    
            # Phase 4: BFS-based edge building on occupancy grid
            print(f"    Building edges via BFS pathfinding...", flush=True)
            edges = build_floor_edges_bfs(nodes, grid, gs, pw, ph)
    
            # Ensure floor graph is fully connected
            edges = ensure_connected(nodes, edges, grid, gs, pw, ph)
    
            print(f"    rooms:{len(rooms)}  doors:{len(pivots)}  "
                  f"edges:{len(edges)}", flush=True)
    
            # Debug visualization (skeleton computed only for debug)
            if debug and debug_dir:
                skeleton, dist_map = extract_hallway_skeleton(grid, min_half_width=8,
                                                               max_half_width=55)
                save_debug_images(debug_dir, fname, page, grid, dist_map, skeleton,
                                   nodes, edges, gs, pw, ph)
    
            all_nodes.extend(nodes)
            all_edges.extend(edges)

    # Save OCR cache if we computed fresh OCR data
    if ocr_cache_data:
        try:
            with open(ocr_cache_file, 'w', encoding='utf-8') as f:
                json.dump(ocr_cache_data, f, separators=(',', ':'))
            print(f"  Cached OCR results to {ocr_cache_file}", flush=True)
        except Exception as e:
            print(f"  Warning: could not save OCR cache: {e}", flush=True)

    n_inter = link_interfloor(all_nodes, all_edges, floors)
    print(f"  inter-floor edges: {n_inter}")

    return {
        "buildingName": building_name,
        "floors": floors,
        "nodes": [n.to_dict() for n in all_nodes],
        "edges": [e.to_dict() for e in all_edges],
        "meta": {
            "nodeCount": len(all_nodes),
            "edgeCount": len(all_edges),
            "generatedBy": "parse_floorplan.py (wall-aware v2)",
        }
    }

def main():
    ap = argparse.ArgumentParser(description="Floor plan PDF => navigation graph JSON")
    ap.add_argument("pdf", help="Path to the floor plan PDF")
    ap.add_argument("-o", "--output", default=None, help="Output JSON path")
    ap.add_argument("--building", default="Building", help="Building name")
    ap.add_argument("--ocr-engine", choices=['easyocr', 'tesseract', 'both'],
                    default='easyocr', help="OCR engine to use (default: easyocr)")
    ap.add_argument("--render-scale", type=int, default=3,
                    help="Occupancy grid render scale (default: 3)")
    ap.add_argument("--debug", action='store_true',
                    help="Save debug visualization PNGs")
    args = ap.parse_args()

    out = args.output or args.pdf.rsplit(".", 1)[0] + "-graph.json"
    debug_dir = None
    if args.debug:
        debug_dir = os.path.join(os.path.dirname(out) or '.', 'debug_viz')

    print(f"Parsing {args.pdf}...")
    data = parse_pdf(args.pdf, args.building, ocr_engine=args.ocr_engine,
                     render_scale=args.render_scale,
                     debug=args.debug, debug_dir=debug_dir)

    with open(out, "w") as f:
        json.dump(data, f, indent=2)

    print(f"\n=> {out}  ({data['meta']['nodeCount']} nodes, {data['meta']['edgeCount']} edges)")
    if args.debug:
        print(f"   Debug images saved to {debug_dir}/")
    print("   Import this JSON into floorplan-editor.html (with the PDF loaded) to review & fix.")

if __name__ == "__main__":
    main()
