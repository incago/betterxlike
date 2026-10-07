"""Build extension icons from the selected X-grid master (requires Pillow)."""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "design/icon-concepts/01-cross-grid-master.png"
master = Image.open(SOURCE).convert("RGBA")
bounds = master.getchannel("A").getbbox()
if bounds is None:
    raise ValueError("The selected icon master is empty")
master = master.crop(bounds)
if master.width != master.height:
    side = max(master.size)
    square = Image.new("RGBA", (side, side))
    square.alpha_composite(master, ((side - master.width) // 2, (side - master.height) // 2))
    master = square


for size in (16, 32, 48, 128):
    inset = 16 if size == 128 else 0
    artwork = master.resize((size - 2 * inset, size - 2 * inset), Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (size, size))
    icon.alpha_composite(artwork, (inset, inset))
    target = ROOT / f"icons/icon-{size}.png"
    target.parent.mkdir(exist_ok=True)
    icon.save(target, optimize=True)
    if size == 128:
        icon.save(ROOT / "store/assets/icon-128.png", optimize=True)
    print(f"Created {target.relative_to(ROOT)}")
