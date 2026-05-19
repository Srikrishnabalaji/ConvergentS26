#!/usr/bin/env python3
"""Draw stairwell/elevator node positions on each floor plan image for verification.

Outputs annotated PNGs to frontend/assets/debug_viz/transport_*.png
Open these to verify nodes are at the right locations before using in the app.

Usage:
    python visualize_transport.py
"""

import json
import os
from PIL import Image, ImageDraw, ImageFont

GRAPH_PATH = "frontend/assets/gdc_graph.json"
FLOORPLAN_DIR = "frontend/assets/floorplans"
OUTPUT_DIR = "frontend/assets/debug_viz"

# Crop parameters matching extract_floor_images.py
CROP = {"left": 0.03, "top": 0.06, "right": 0.97, "bottom": 0.84}
CROP_W = CROP["right"] - CROP["left"]
CROP_H = CROP["bottom"] - CROP["top"]

COLORS = {
    "elevator": (0, 120, 255),    # blue
    "stairwell": (255, 60, 60),   # red
}


def to_image_xy(nx, ny, img_w, img_h):
    x = ((nx - CROP["left"]) / CROP_W) * img_w
    y = ((ny - CROP["top"]) / CROP_H) * img_h
    return int(x), int(y)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(GRAPH_PATH) as f:
        data = json.load(f)

    floors = data["floors"]
    transport_nodes = [n for n in data["nodes"] if n["type"] in ("stairwell", "elevator")]

    print(f"Found {len(transport_nodes)} transport nodes across {len(floors)} floors\n")

    for floor in floors:
        fid = floor["id"]
        floor_num = int(fid[1:]) + 1
        img_path = f"{FLOORPLAN_DIR}/gdc_floor_{floor_num}.png"
        out_path = f"{OUTPUT_DIR}/transport_floor_{floor_num}.png"

        if not os.path.exists(img_path):
            raise FileNotFoundError(f"Missing floorplan image: {img_path}")
        img = Image.open(img_path).convert("RGB")
        draw = ImageDraw.Draw(img)
        w, h = img.size

        floor_transport = [n for n in transport_nodes if n["floorId"] == fid]
        print(f"Floor {floor_num} ({fid}): {len(floor_transport)} transport nodes")

        for node in floor_transport:
            px, py = to_image_xy(node["x"], node["y"], w, h)
            color = COLORS.get(node["type"], (128, 128, 128))
            r = 20

            # Draw circle with outline
            draw.ellipse([px - r, py - r, px + r, py + r], fill=color, outline=(255, 255, 255), width=3)

            # Draw label
            label = f"{node['label']}"
            # Draw text background
            bbox = draw.textbbox((px + r + 5, py - 10), label)
            draw.rectangle([bbox[0] - 2, bbox[1] - 2, bbox[2] + 2, bbox[3] + 2], fill=(0, 0, 0))
            draw.text((px + r + 5, py - 10), label, fill=(255, 255, 255))

            # Also show which room it's connected to
            connected_edges = [e for e in data["edges"]
                               if (e["from"] == node["id"] or e["to"] == node["id"])
                               and not e.get("interFloor")]
            for edge in connected_edges:
                other_id = edge["to"] if edge["from"] == node["id"] else edge["from"]
                other = next((n for n in data["nodes"] if n["id"] == other_id), None)
                if other:
                    ox, oy = to_image_xy(other["x"], other["y"], w, h)
                    # Draw line from transport to connected room
                    draw.line([(px, py), (ox, oy)], fill=color, width=2)
                    # Draw small circle at connected room
                    draw.ellipse([ox - 6, oy - 6, ox + 6, oy + 6], fill=(0, 200, 0), outline=(255, 255, 255), width=2)
                    draw.text((ox + 10, oy - 5), other["label"], fill=color)

            print(f"  {node['type']:10s} {node['label']:20s} → pixel ({px}, {py})")

        img.save(out_path)
        print(f"  Saved → {out_path}\n")

    print("Done! Open the images in frontend/assets/debug_viz/transport_floor_*.png")
    print("Legend: BLUE = elevator, RED = stairwell, GREEN = connected room")


if __name__ == "__main__":
    main()
