"""Package only the extension's runtime files and installation guide."""
import json
import argparse
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--store", action="store_true", help="Create a Chrome Web Store ZIP with runtime files only")
args = parser.parse_args()
manifest = json.loads((root / "manifest.json").read_text())
assets = {"manifest.json", manifest["action"]["default_popup"], "popup.js", "popup.css"}
if not args.store:
    assets.update(["README.md", "README.en.md", "README.ja.md"])
assets.update(str(file.relative_to(root)) for file in (root / "_locales").glob("*/messages.json"))
assets.update(manifest["icons"].values())
for script in manifest["content_scripts"]:
    assets.update(script.get("js", []))
    assets.update(script.get("css", []))

output = root / (f"store/better-x-likes-{manifest['version']}-webstore.zip" if args.store else f"better-x-likes-{manifest['version']}.zip")
output.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for asset in sorted(assets):
        archive.write(root / asset, asset)

with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
print(f"Created {output.name} ({output.stat().st_size:,} bytes, {len(assets)} files)")
