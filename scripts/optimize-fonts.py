"""Generate compact local WOFF fonts, preserving Portuguese and shop symbols."""
from pathlib import Path
from fontTools import subset

root = Path(__file__).resolve().parents[1] / "public/assets/fonts"
codepoints = set(range(0x100)) | set(range(0x2000, 0x2070)) | set(range(0x20A0, 0x20D0)) | set(range(0x2190, 0x2200))
for source in sorted(root.glob("*.ttf")):
    options = subset.Options()
    options.flavor = "woff"
    options.layout_features = ["*"]
    font = subset.load_font(str(source), options)
    reducer = subset.Subsetter(options=options)
    reducer.populate(unicodes=codepoints)
    reducer.subset(font)
    target = source.with_suffix(".woff")
    subset.save_font(font, str(target), options)
    print(f"{source.name}: {source.stat().st_size} → {target.stat().st_size} bytes")
