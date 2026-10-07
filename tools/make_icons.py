"""Generate simple grid icons using only Python's standard library."""
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / "icons"


def rounded(x, y, left, top, right, bottom, radius):
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            # Store icon: 96px artwork centered in a transparent 128px canvas.
            inset = 16 if size == 128 else 0
            artwork = size - 2 * inset
            px, py = (x + .5 - inset) / artwork, (y + .5 - inset) / artwork
            color = (14, 20, 27, 255) if rounded(px, py, 0, 0, 1, 1, .2) else (0, 0, 0, 0)
            for left, top in ((.19, .19), (.54, .19), (.19, .54), (.54, .54)):
                if rounded(px, py, left, top, left + .27, top + .27, .055):
                    color = (70, 212, 182, 255)
            rows.extend(color)
    header = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    ROOT.mkdir(exist_ok=True)
    (ROOT / f"icon-{size}.png").write_bytes(png)
