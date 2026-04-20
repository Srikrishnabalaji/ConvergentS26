#!/usr/bin/env python3
"""Stylize floor-plan PNGs with Gemini (image → image).

Default I/O:
  frontend/assets/floorplans/{prefix}_{n}.png
  → frontend/assets/floorplans-stylized/{prefix}_{n}_stylized.png
"""

from __future__ import annotations

import argparse
import io
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Iterable, Optional

try:
    from google import genai
    from google.genai import types
except ImportError:
    print(
        "ERROR: google-genai is not installed for this Python.\n"
        "       python3 -m pip install -r backend/requirements.txt",
        file=sys.stderr,
    )
    sys.exit(1)

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None  # type: ignore[assignment]

try:
    from PIL import Image, ImageFilter
except ImportError:
    Image = None  # type: ignore[assignment]
    ImageFilter = None  # type: ignore[assignment]


DEFAULT_MODEL = "gemini-3-pro-image-preview"
# Served on Vertex only as location=global (script forces this when using Vertex).
PRO_IMAGE_MODELS = {"gemini-3-pro-image-preview"}

DEFAULT_ASPECT_RATIO = "16:9"
DEFAULT_IMAGE_SIZE = "4K"

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT_DIR = REPO_ROOT / "frontend" / "assets" / "floorplans"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "frontend" / "assets" / "floorplans-stylized"
DEFAULT_PREFIX = "gdc_floor"
DEFAULT_FLOORS = range(1, 8)

PER_REQUEST_DELAY_S = 1.5
DEFAULT_UPSCALE_MODE = "none"
DEFAULT_UPSCALE_FACTOR = 2

PROMPT = """Redraw this floor plan in ONE fixed indoor-map style. Use the exact same visual rules every time, no matter how busy the source image is: same colors, same line style, same level of detail.

Look: flat vector map. Solid fills only—no grain, speckles, dithering, or fuzzy shading. Walls are clean dark grey or black outlines with the SAME thickness for interior and exterior—draw walls as lines, not as white gaps between colored regions. Light blue for all enclosed rooms, light grey for hallways and open circulation, light yellow only for stair and elevator areas, white outside the building.

Keep room numbers from the source: simple black text, centered in each room, same approximate size relative to the room. Do not add extra labels.

Simplify: no door swing arcs or curved door symbols; no window ticks along the outside; bathrooms and service rooms can be simple blue shapes without dense inner detail. Stairs/elevators in yellow: keep indication minimal (simple lines or blocks), not noisy hatch.

Output must look like it belongs in the same map series as any other floor—not a different art style."""

def _load_env() -> None:
    if load_dotenv is None:
        return
    for candidate in (REPO_ROOT / ".env", Path.cwd() / ".env"):
        if candidate.exists():
            load_dotenv(candidate)
            return

def _get_client(model: str, force_api_key: bool = False) -> genai.Client:
    project = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT")
    if model in PRO_IMAGE_MODELS:
        location = "global"
    else:
        location = (
            os.environ.get("GOOGLE_CLOUD_LOCATION")
            or os.environ.get("GCLOUD_LOCATION")
            or "us-central1"
        )
    api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")

    if not force_api_key and project:
        print(f"Auth: Vertex AI  (project={project}, location={location})")
        return genai.Client(vertexai=True, project=project, location=location)

    if api_key:
        print("Auth: Gemini Developer API (API key)")
        return genai.Client(api_key=api_key)

    print(
        "ERROR: No credentials configured.\n"
        "       Set GOOGLE_CLOUD_PROJECT in .env or set GEMINI_API_KEY.\n",
        file=sys.stderr,
    )
    sys.exit(1)

def _extract_first_image(response) -> Optional[bytes]:
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        if content is None:
            continue
        for part in getattr(content, "parts", None) or []:
            inline = getattr(part, "inline_data", None)
            if inline is not None and getattr(inline, "data", None):
                return inline.data
    return None

def _upscale_lanczos(image_bytes: bytes, factor: int) -> bytes:
    if Image is None or ImageFilter is None:
        raise RuntimeError("Pillow is not installed.")
    im = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    new_size = (im.width * factor, im.height * factor)
    up = im.resize(new_size, Image.LANCZOS)
    up = up.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=0))
    buf = io.BytesIO()
    up.save(buf, format="PNG", optimize=True)
    return buf.getvalue()

def _upscale_esrgan(image_bytes: bytes, factor: int) -> bytes:
    binary = shutil.which("realesrgan-ncnn-vulkan")
    if not binary:
        raise RuntimeError("realesrgan-ncnn-vulkan not found on PATH.")
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "in.png"
        out_path = Path(td) / "out.png"
        in_path.write_bytes(image_bytes)
        cmd = [
            binary, "-i", str(in_path), "-o", str(out_path),
            "-s", str(factor), "-n", "realesrgan-x4plus-anime",
        ]
        res = subprocess.run(cmd, capture_output=True, text=True)
        if res.returncode != 0:
            raise RuntimeError(f"realesrgan failed: {res.stderr.strip()}")
        return out_path.read_bytes()

def _apply_upscale(image_bytes: bytes, mode: str, factor: int) -> bytes:
    if mode == "none" or factor <= 1:
        return image_bytes
    if mode == "lanczos":
        return _upscale_lanczos(image_bytes, factor)
    if mode == "esrgan":
        return _upscale_esrgan(image_bytes, factor)
    raise ValueError(f"Unknown upscale mode: {mode!r}")

def _extract_text(response) -> str:
    out: list[str] = []
    candidates = getattr(response, "candidates", None) or []
    for cand in candidates:
        content = getattr(cand, "content", None)
        if content is None:
            continue
        for part in getattr(content, "parts", None) or []:
            text = getattr(part, "text", None)
            if text:
                out.append(text)
    return "\n".join(out).strip()

def _build_config(
    model: str,
    aspect_ratio: str,
    image_size: Optional[str],
) -> types.GenerateContentConfig:
    """Pro Image needs response_modalities TEXT+IMAGE; optional image_size."""
    kwargs = {"response_modalities": ["TEXT", "IMAGE"]}
    image_config_cls = getattr(types, "ImageConfig", None)
    if image_config_cls is not None and aspect_ratio:
        ic_kwargs = {"aspect_ratio": aspect_ratio}
        if image_size:
            ic_kwargs["image_size"] = image_size
        try:
            kwargs["image_config"] = image_config_cls(**ic_kwargs)
        except TypeError:
            try:
                kwargs["image_config"] = image_config_cls(aspect_ratio=aspect_ratio)
            except Exception:  # noqa: BLE001
                pass
        except Exception:
            try:
                kwargs["image_config"] = image_config_cls(aspect_ratio=aspect_ratio)
            except Exception:  # noqa: BLE001
                pass
    return types.GenerateContentConfig(**kwargs)


def stylize_one(
    client: genai.Client,
    model: str,
    aspect_ratio: str,
    image_size: Optional[str],
    input_path: Path,
    output_path: Path,
    upscale_mode: str,
    upscale_factor: int,
) -> bool:
    image_bytes = input_path.read_bytes()
    response = client.models.generate_content(
        model=model,
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            PROMPT,
        ],
        config=_build_config(model, aspect_ratio, image_size),
    )

    image_data = _extract_first_image(response)
    if image_data is None:
        text = _extract_text(response)
        print(f"    ✗ Gemini returned no image. Model said: {text[:400]!r}", file=sys.stderr)
        return False

    raw_w = raw_h = up_w = up_h = 0
    if Image is not None:
        raw = Image.open(io.BytesIO(image_data))
        raw_w, raw_h = raw.size

    if upscale_mode != "none" and upscale_factor > 1:
        try:
            image_data = _apply_upscale(image_data, upscale_mode, upscale_factor)
            if Image is not None:
                up = Image.open(io.BytesIO(image_data))
                up_w, up_h = up.size
        except Exception as exc:  # noqa: BLE001
            print(f"    ! upscale ({upscale_mode}×{upscale_factor}) failed: {exc}", file=sys.stderr)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_data)

    suffix = f" → upscaled to {up_w}×{up_h}" if up_w else ""
    print(f"    ✓ saved {output_path.name}  (Gemini: {raw_w}×{raw_h}{suffix})")
    return True

def _iter_floors(floors: Optional[Iterable[int]]) -> list[int]:
    if floors is None:
        return list(DEFAULT_FLOORS)
    return list(floors)

def main() -> int:
    parser = argparse.ArgumentParser(description="Stylize floor-plan PNGs with Gemini.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR))
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--prefix", default=DEFAULT_PREFIX)
    parser.add_argument("--floor", type=int, action="append")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--use-api-key", action="store_true")
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=(
            f"Gemini image model (default: {DEFAULT_MODEL}). Use "
            f"'gemini-2.5-flash-image' to downgrade to the Flash tier."
        ),
    )
    parser.add_argument(
        "--aspect-ratio",
        default=DEFAULT_ASPECT_RATIO,
        help=(
            "Output aspect ratio. Supported: 1:1, 3:2, 2:3, 3:4, 4:3, "
            "4:5, 5:4, 9:16, 16:9, 21:9. Default 16:9 matches the GDC "
            "floor-plan PNG shape (~1.86:1)."
        ),
    )
    parser.add_argument(
        "--image-size",
        default=DEFAULT_IMAGE_SIZE,
        choices=["1K", "2K", "4K"],
        help=(
            "Gemini output resolution tier (1K / 2K / 4K). Default 4K for "
            "sharpest linework; requires SDK + model support (may be ignored)."
        ),
    )
    parser.add_argument("--upscale", choices=["none", "lanczos", "esrgan"], default=DEFAULT_UPSCALE_MODE)
    parser.add_argument("--upscale-factor", type=int, default=DEFAULT_UPSCALE_FACTOR)
    args = parser.parse_args()

    _load_env()
    client = _get_client(model=args.model, force_api_key=args.use_api_key)

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    floors = _iter_floors(args.floor)

    print(
        f"Stylizing floors {floors}\n"
        f"  model : {args.model}\n"
        f"  aspect: {args.aspect_ratio}\n"
        f"  size  : {args.image_size}\n"
        f"  in    : {input_dir}\n"
        f"  out   : {output_dir}\n"
    )

    ok_count = 0
    for i, floor in enumerate(floors):
        in_path = input_dir / f"{args.prefix}_{floor}.png"
        out_path = output_dir / f"{args.prefix}_{floor}_stylized.png"

        if not in_path.exists():
            print(f"  Floor {floor}: SKIP — input missing ({in_path})")
            continue
        if out_path.exists() and not args.force:
            print(f"  Floor {floor}: SKIP — output already exists")
            ok_count += 1
            continue

        print(f"  Floor {floor}: {in_path.name} -> {out_path.name} ...")
        try:
            if stylize_one(
                client,
                model=args.model,
                aspect_ratio=args.aspect_ratio,
                image_size=args.image_size,
                input_path=in_path,
                output_path=out_path,
                upscale_mode=args.upscale,
                upscale_factor=args.upscale_factor,
            ):
                ok_count += 1
        except Exception as exc:
            print(f"    ✗ error: {exc}", file=sys.stderr)
            break

        if i < len(floors) - 1:
            time.sleep(PER_REQUEST_DELAY_S)

    print(f"\nDone — {ok_count}/{len(floors)} floor(s) processed.")
    return 0 if ok_count == len(floors) else 1

if __name__ == "__main__":
    sys.exit(main())