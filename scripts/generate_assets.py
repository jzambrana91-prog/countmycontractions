#!/usr/bin/env python3
"""Generate the printable PDF, icons, and social image.

Pillow is used for the PNG files. The PDF is plain text operators so it stays
small and selectable. From the repo root:

    python3 -m pip install pillow
    python3 scripts/generate_assets.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
FONT = "/usr/share/fonts/truetype/macos/Inter-Regular.ttf"
SERIF = "/usr/share/fonts/truetype/noto/NotoSerif-Bold.ttf"

INK = (26, 20, 18)
CREAM = (251, 244, 238)
CORAL = (231, 161, 140)
DEEP = (43, 18, 14)


def png_icon(size: int, maskable: bool) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if maskable:
        draw.rectangle((0, 0, size, size), fill=INK + (255,))
        pad = int(size * 0.16)
        draw.rounded_rectangle((pad, pad, size - pad, size - pad), radius=int(size * 0.18), fill=(39, 30, 27, 255))
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=INK + (255,))
    cx = cy = size / 2
    radius = size * (0.22 if maskable else 0.26)
    width = max(2, int(size * 0.045))
    draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), outline=CORAL + (255,), width=width)
    dot = size * 0.055
    draw.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=CORAL + (255,))
    hand_top = cy - radius
    draw.line((cx, hand_top + width, cx, cy - dot * 1.4), fill=CORAL + (255,), width=width)
    return image


def og_image() -> Image.Image:
    image = Image.new("RGB", (1200, 630), INK)
    draw = ImageDraw.Draw(image)
    draw.ellipse((70, 115, 430, 475), outline=CORAL, width=18)
    draw.ellipse((232, 277, 268, 313), fill=CORAL)
    draw.line((250, 175, 250, 250), fill=CORAL, width=16)
    title = ImageFont.truetype(SERIF, 78)
    sub = ImageFont.truetype(FONT, 36)
    small = ImageFont.truetype(FONT, 28)
    draw.text((500, 180), "Count My\nContractions", font=title, fill=CREAM, spacing=8)
    draw.text((500, 390), "Free contraction timer", font=sub, fill=CORAL)
    draw.text((500, 450), "Private. On your phone. No account.", font=small, fill=(215, 195, 182))
    return image


def escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\)").replace(")", "\\)")


def finish_pdf(stream: bytes) -> bytes:
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    ]
    output = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(output))
        output.extend(f"{index} 0 obj\n".encode("ascii"))
        output.extend(body)
        output.extend(b"\nendobj\n")
    startxref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for offset in offsets:
        output.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{startxref}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)


def main() -> None:
    icons = PUBLIC / "icons"
    downloads = PUBLIC / "downloads"
    icons.mkdir(parents=True, exist_ok=True)
    downloads.mkdir(parents=True, exist_ok=True)

    png_icon(192, False).save(icons / "icon-192.png")
    png_icon(512, False).save(icons / "icon-512.png")
    png_icon(512, True).save(icons / "icon-maskable-512.png")
    png_icon(180, False).save(icons / "apple-touch-icon.png")
    og_image().save(PUBLIC / "og.png", optimize=True)
    (downloads / "contraction-log.pdf").write_bytes(finish_pdf(pdf_stream()))
    print("Wrote icons, og.png, and contraction-log.pdf")


def pdf_stream() -> bytes:
    # Reuse the command builder by calling contraction_pdf's inner logic.
    # contraction_pdf() accidentally double-wraps; build commands here.
    commands: list[str] = []

    def text(font: str, size: float, x: float, y: float, value: str, gray: str = "0.102 0.078 0.071") -> None:
        commands.append(f"BT /{font} {size} Tf {gray} rg 1 0 0 1 {x} {y} Tm ({escape(value)}) Tj ET")

    commands.append("0.102 0.078 0.071 rg")
    commands.append("0 548 792 64 re f")
    commands.append("0.906 0.631 0.549 rg")
    commands.append("36 572 16 16 re f")
    text("F2", 20, 62, 574, "Count My Contractions", "0.984 0.957 0.933")
    text("F1", 11, 62, 556, "Free contraction log   |   frequency is measured start to start", "0.906 0.631 0.549")
    text("F2", 15, 36, 520, "Labor contraction log")
    text("F1", 10, 36, 500, "Name (optional) ____________________     Date ______________     Weeks pregnant ______")
    text("F1", 10, 36, 484, "Provider or birth-unit phone ____________________     Pattern they asked you to watch ________")
    text("F1", 9, 36, 468, "Apart is the time from one start to the next start. Rest is the gap after a contraction eases.")

    columns = [36, 68, 160, 262, 348, 458, 548, 756]
    headers = ["#", "Start", "End", "Length", "Apart", "Rest", "Notes"]
    top = 452
    row_h = 22
    data_rows = 14
    header_y = top - row_h
    bottom = header_y - row_h * data_rows
    commands.append("0.45 0.36 0.31 RG")
    commands.append("0.7 w")
    for index in range(data_rows + 1):
        y = header_y - row_h * index
        commands.append(f"{columns[0]} {y} m {columns[-1]} {y} l S")
    commands.append(f"{columns[0]} {top} m {columns[-1]} {top} l S")
    for x in columns:
        commands.append(f"{x} {bottom} m {x} {top} l S")
    for index, header in enumerate(headers):
        text("F2", 9, columns[index] + 4, header_y + 6, header)
    for index in range(data_rows):
        y = header_y - row_h * (index + 1) + 6
        text("F1", 10, columns[0] + 6, y, str(index + 1))

    text("F1", 8.5, 36, 78, "Timing aid, not medical advice. This sheet does not diagnose labor or tell you when it is safe to stay home.")
    text("F1", 8.5, 36, 66, "Call your provider now for broken waters, bleeding, less baby movement, contractions before 37 weeks,")
    text("F1", 8.5, 36, 54, "a contraction over 2 minutes, or 6 or more contractions in 10 minutes. Call emergency services if birth seems imminent.")
    text("F1", 8.5, 36, 36, "countmycontractions.com/printable-contraction-log")
    return "\n".join(commands).encode("latin-1")


if __name__ == "__main__":
    main()
