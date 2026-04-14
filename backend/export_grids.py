#!/usr/bin/env python3
"""Export per-floor occupancy grids for the JS runtime A* engine.

Each grid is a compact JSON file: { width, height, scale, pageWidth,
pageHeight, data } where `data` is a base64 string of packed bits
(1 = passable corridor, 0 = wall), MSB-first per byte.

The JS side (grid-astar.ts) decodes this into a Uint8Array and runs A*
on it to compute wall-respecting corridor paths at navigation time.

Why scale=1?
  At scale=1 each PDF point maps to one grid pixel.  Wall lines are drawn
  at 7 px thickness, which cleanly blocks rooms at this density without
  sealing doorways (a 15-pt doorway → 15 px clear minus 7 px wall = 8 px
  of passable corridor through the opening).  Smaller scales make doorways
  too narrow for A* to thread through.

Usage:
    python export_grids.py <GDC.pdf> [--out DIR] [--scale N] [--graph PATH]
    python export_grids.py /path/GDC.pdf --out ../frontend/assets/grids

The optional --graph flag points at the graph JSON used to seed the
"which CC is the corridor network?" picker. Defaults to
frontend/assets/gdc_graph.json relative to this script.
"""

import sys, os, json, base64
import numpy as np

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT   = os.path.dirname(BACKEND_DIR)
DEFAULT_OUT = os.path.join(REPO_ROOT, 'frontend', 'assets', 'grids')
DEFAULT_SCALE = 2


def pack_grid(grid: np.ndarray) -> bytes:
    """Pack a 2-D uint8 occupancy grid into a packed-bit byte array."""
    bits = (grid.flatten() > 0).astype(np.uint8)
    # Pad to multiple of 8 so np.packbits doesn't truncate.
    pad = (8 - len(bits) % 8) % 8
    if pad:
        bits = np.append(bits, np.zeros(pad, dtype=np.uint8))
    return np.packbits(bits, bitorder='big').tobytes()


def main():
    if len(sys.argv) < 2:
        print("Usage: python export_grids.py <GDC.pdf> [--out DIR] [--scale N]")
        sys.exit(1)

    pdf_path   = sys.argv[1]
    out_dir    = DEFAULT_OUT
    scale      = DEFAULT_SCALE
    graph_path = os.path.join(REPO_ROOT, 'frontend', 'assets', 'gdc_graph.json')

    i = 2
    while i < len(sys.argv):
        if sys.argv[i] == '--out' and i + 1 < len(sys.argv):
            out_dir = sys.argv[i + 1]; i += 2
        elif sys.argv[i] == '--scale' and i + 1 < len(sys.argv):
            scale = float(sys.argv[i + 1]); i += 2
        elif sys.argv[i] == '--graph' and i + 1 < len(sys.argv):
            graph_path = sys.argv[i + 1]; i += 2
        else:
            i += 1

    os.makedirs(out_dir, exist_ok=True)

    # Load graph nodes per floor — used to seed which connected component
    # is "the corridor network" (the one containing the most rooms).
    nodes_by_floor: dict = {}
    if os.path.exists(graph_path):
        with open(graph_path) as gf:
            gdata = json.load(gf)
        for n in gdata.get('nodes', []):
            nodes_by_floor.setdefault(n['floorId'], []).append((n['x'], n['y']))

    import fitz, cv2

    doc = fitz.open(pdf_path)
    print(f"Exporting {len(doc)} floor grids at scale={scale} → {out_dir}/")

    for page_idx in range(len(doc)):
        floor_id = f'f{page_idx}'
        page     = doc[page_idx]
        pw       = page.rect.width
        ph       = page.rect.height

        # Rasterize the PDF page directly.  The PDF renderer correctly draws
        # all walls as solid strokes and leaves doorway gaps open.  We do NOT
        # apply vector wall overlays or morphological closing here — those
        # operations are designed to help parse_floorplan's BFS stay in
        # corridors, but they seal doorways that the arc detector missed.
        # For A* we want a maximally passable grid: every real door opening
        # is navigable, even if its arc wasn't detected.
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale))
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n)
        if pix.n == 4:
            import cv2 as _cv2; gray = _cv2.cvtColor(img, _cv2.COLOR_RGBA2GRAY)
        elif pix.n == 3:
            gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
        else:
            gray = img

        # Threshold: dark ink (walls) → 0, light (corridor/room) → 255
        _, grid = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY)

        # Morphological CLOSE on the walls (= OPEN on the passable mask)
        # to seal hairline cracks in partition walls.  The PDF rasterizer
        # leaves 2-3 px gaps where wall strokes meet at junctions, where
        # furniture/cabinet outlines have tiny rendering artefacts, and
        # along the edges of interior boxes (4.2E2, 4.2E3, etc.).  A*
        # threads through those gaps, producing visual wall-cuts.
        #
        # We erode the passable region by 2 px first (this removes any
        # passable strip ≤ 4 px wide — hairline cracks gone), then dilate
        # back by 1 px so real corridors and doorways (≥ 15 px wide) still
        # have plenty of clearance.  Net effect: walls grow by 1 px and
        # cracks ≤ 3 px wide are completely sealed.
        # Morphological CLOSE on the wall mask (dilate walls then erode
        # walls back).  This bridges hairline cracks BETWEEN walls without
        # changing the width of real doorways: a 15-px doorway gets walls
        # thickened by 1 px on each side (still ≈13 px opening), but a
        # 2-px crack between two wall ends gets fully sealed.
        # We do NOT also erode the passable region — that turned out to
        # close 4.414A's narrow doorway, isolating it from the corridor.
        kernel = np.ones((3, 3), np.uint8)
        wall_mask = cv2.bitwise_not(grid)
        wall_mask = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE, kernel,
                                     iterations=1)
        grid = cv2.bitwise_not(wall_mask)

        # ── Mask room interiors so A* stays in real corridors ──
        # The rasterized floor plan only marks wall LINES as dark; room
        # interiors are white and therefore "passable". A* exploits this by
        # phasing diagonally through rooms whose doorways line up. To stop
        # that, we identify room interiors and mark them as walls.
        #
        # Approach: aggressively close the wall mask with a kernel larger
        # than the typical doorway width (~15 px at scale=2). This bridges
        # every doorway, splitting the previously-monolithic passable
        # region into one component per room plus one big component for
        # the corridor network.
        #
        # Picking the right component: "largest CC" is naive because the
        # white strip OUTSIDE the building outline can be larger than the
        # interior corridors on rooms-heavy floors. Instead, we score each
        # CC by how many graph nodes (= real rooms) it contains and pick
        # the highest-scoring one. Exterior CCs contain zero rooms and
        # automatically lose.
        seal_size = 19   # > doorway width (15px); seals every door
        seal_kernel = np.ones((seal_size, seal_size), np.uint8)
        sealed_walls = cv2.morphologyEx(wall_mask, cv2.MORPH_CLOSE,
                                        seal_kernel, iterations=1)
        sealed_passable = cv2.bitwise_not(sealed_walls)

        num, labels, stats, _ = cv2.connectedComponentsWithStats(
            sealed_passable, connectivity=8)

        floor_nodes = nodes_by_floor.get(floor_id, [])
        chosen = 0
        if num > 1 and floor_nodes:
            h_g, w_g = labels.shape
            scores: dict = {}
            for nx, ny in floor_nodes:
                px = int(round(nx * pw * scale))
                py = int(round(ny * ph * scale))
                px = max(0, min(w_g - 1, px))
                py = max(0, min(h_g - 1, py))
                # Spiral out to find the nearest sealed-passable pixel; its
                # CC label is what this node "belongs to".
                lbl = int(labels[py, px])
                if lbl == 0:
                    found = False
                    for r in range(1, 80):
                        for dy in range(-r, r + 1):
                            for dx in range(-r, r + 1):
                                if abs(dy) != r and abs(dx) != r:
                                    continue
                                nx2, ny2 = px + dx, py + dy
                                if 0 <= nx2 < w_g and 0 <= ny2 < h_g:
                                    cand = int(labels[ny2, nx2])
                                    if cand != 0:
                                        lbl = cand; found = True; break
                            if found: break
                        if found: break
                if lbl != 0:
                    scores[lbl] = scores.get(lbl, 0) + 1
            if scores:
                chosen = max(scores.items(), key=lambda kv: kv[1])[0]
        if chosen == 0 and num > 1:
            # No graph available — fall back to largest CC.
            sizes = stats[1:, cv2.CC_STAT_AREA]
            chosen = 1 + int(np.argmax(sizes))

        if chosen != 0:
            corridor = (labels == chosen).astype(np.uint8) * 255
            # Recover doorways by dilating the corridor back by ~the same
            # amount we sealed. AND with original passable so we don't
            # bleed through walls into adjacent rooms.
            recover_size = 19
            recover_kernel = np.ones((recover_size, recover_size), np.uint8)
            corridor = cv2.dilate(corridor, recover_kernel, iterations=1)
            grid = cv2.bitwise_and(grid, corridor)

            # The dilate+AND step can leak passable pixels through doorways
            # into adjacent rooms, creating tiny disconnected islands. If a
            # hardcoded transport position snaps onto one of those islands,
            # A* can never reach the rest of the building. Fix: keep only
            # the LARGEST CC of the final grid — by construction, that's
            # the contiguous corridor network we just selected.
            num2, labels2, stats2, _ = cv2.connectedComponentsWithStats(
                grid, connectivity=8)
            if num2 > 1:
                sizes2 = stats2[1:, cv2.CC_STAT_AREA]
                main = 1 + int(np.argmax(sizes2))
                grid = ((labels2 == main).astype(np.uint8) * 255)

        # Crop the same margins as render_occupancy_grid so node coordinates
        # (which are normalized to the full page) map correctly onto the grid.
        h_raw, w_raw = grid.shape
        margin = 0.10
        grid[:int(h_raw * margin), :]            = 0   # top margin
        grid[int(h_raw * (1 - 0.18)):, :]        = 0   # bottom margin
        grid[:, :int(w_raw * margin)]             = 0   # left margin
        grid[:, int(w_raw * (1 - margin)):]       = 0   # right margin

        gs = float(scale)
        h, w = grid.shape

        # ── Compute distance transform ──
        # For each passable pixel, compute distance to nearest wall.
        # This will be used by A* to prefer corridor centerlines over edges.
        # Distance = 0 at walls, max at corridor centers.
        dist_transform = cv2.distanceTransform((grid > 0).astype(np.uint8),
                                               cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
        # Normalize to uint8: [0, 255] where 255 = farthest from wall
        dist_max = dist_transform.max()
        if dist_max > 0:
            dist_norm = (dist_transform / dist_max * 255).astype(np.uint8)
        else:
            dist_norm = dist_transform.astype(np.uint8)

        # Encode distance transform as raw bytes (NOT bit-packed).
        # Each byte is a uint8 value (0-255) representing distance to nearest wall.
        dist_bytes = dist_norm.flatten().tobytes()
        dist_encoded = base64.b64encode(dist_bytes).decode('ascii')

        packed  = pack_grid(grid)
        encoded = base64.b64encode(packed).decode('ascii')

        out = {
            "floorId":    floor_id,
            "pageIndex":  page_idx,
            "width":      w,
            "height":     h,
            "scale":      gs,
            "pageWidth":  float(pw),
            "pageHeight": float(ph),
            # base64 packed bits: MSB first, 1=passable, 0=wall
            # Total bits = width * height (padded to multiple of 8).
            "data":       encoded,
            # base64 packed uint8: distance to nearest wall per pixel
            # 0=wall, 255=farthest from wall (corridor centerline)
            "distanceData": dist_encoded,
        }

        out_path = os.path.join(out_dir, f'gdc_{floor_id}.json')
        with open(out_path, 'w') as f:
            json.dump(out, f, separators=(',', ':'))

        size_kb      = os.path.getsize(out_path) / 1024
        passable_pct = 100.0 * int((grid > 0).sum()) / grid.size
        print(f"  {floor_id}: {w}×{h}, {passable_pct:.0f}% passable, "
              f"{size_kb:.0f} KB → gdc_{floor_id}.json")

    print("\nDone. Add these files to frontend/assets/grids/ and import them")
    print("in IndoorMapView.tsx via the FLOOR_GRIDS constant.")


if __name__ == '__main__':
    main()
