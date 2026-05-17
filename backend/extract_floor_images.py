#!/usr/bin/env python3
"""Extract each page of a floor-plan PDF as a cropped PNG for the mobile app.

Crops out the margins, title block, and UT logo using PyMuPDF clip rects
so only the building floor plan is visible.
"""

import argparse, os
import fitz  # PyMuPDF

def main():
    parser = argparse.ArgumentParser(description="Extract PDF pages as cropped PNGs")
    parser.add_argument("pdf", help="Path to the floor-plan PDF")
    parser.add_argument("-o", "--outdir", default=".", help="Output directory")
    parser.add_argument("--scale", type=float, default=2.5, help="Render scale")
    parser.add_argument("--prefix", default="floor", help="Filename prefix")
    args = parser.parse_args()

    if os.path.basename(args.prefix) != args.prefix:
        parser.error("--prefix must be a filename prefix, not a path")
    if args.scale <= 0 or args.scale > 5:
        parser.error("--scale must be between 0 and 5")

    os.makedirs(args.outdir, exist_ok=True)

    with fitz.open(args.pdf) as doc:
        for i, page in enumerate(doc):
            pw, ph = page.rect.width, page.rect.height

            # Crop: remove top 6%, bottom 16% (UT logo + title block), sides 3%
            clip = fitz.Rect(
                pw * 0.03,       # left
                ph * 0.06,       # top
                pw * 0.97,       # right
                ph * 0.84,       # bottom
            )

            mat = fitz.Matrix(args.scale, args.scale)
            pix = page.get_pixmap(matrix=mat, clip=clip)

            out_path = os.path.join(args.outdir, f"{args.prefix}_{i+1}.png")
            pix.save(out_path)
            print(f"  Page {i+1} → {out_path}  ({pix.width}x{pix.height})")

        print(f"\nDone — {len(doc)} pages extracted to {args.outdir}/")

if __name__ == "__main__":
    main()
