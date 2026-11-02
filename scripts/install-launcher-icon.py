"""Generate Android launcher resources directly from the supplied PNG artwork."""
from pathlib import Path
import re
import sys
from PIL import Image

source, resources = map(Path, sys.argv[1:3])
with Image.open(source) as original:
    artwork = original.convert("RGBA")
if artwork.width != artwork.height:
    raise ValueError("Launcher artwork must be square")
resources.mkdir(parents=True, exist_ok=True)
for folder in resources.glob("mipmap-*"):
    for old in folder.glob("ic_launcher*"):
        if old.is_file():
            old.unlink()
for folder in resources.glob("drawable*"):
    for name in ("ic_launcher_foreground.xml", "ic_launcher_background.xml"):
        old = folder / name
        if old.is_file():
            old.unlink()
for density, size in {"mdpi":48,"hdpi":72,"xhdpi":96,"xxhdpi":144,"xxxhdpi":192}.items():
    target = resources / ("mipmap-" + density)
    target.mkdir(parents=True, exist_ok=True)
    image = artwork.resize((size,size), Image.Resampling.LANCZOS)
    for name in ("ic_launcher.png","ic_launcher_round.png"):
        image.save(target / name, optimize=True)
foreground = Image.new("RGBA", (432,432), (0,0,0,0))
foreground.alpha_composite(artwork.resize((288,288), Image.Resampling.LANCZOS), (72,72))
drawable = resources / "drawable"
drawable.mkdir(exist_ok=True)
foreground.save(drawable / "pokevoid_icon_foreground.png", optimize=True)
values = resources / "values"
values.mkdir(exist_ok=True)
(values / "pokevoid_icon_background.xml").write_text('<resources><color name="pokevoid_icon_background">#0b0318</color></resources>\n', encoding="utf-8")
adaptive = resources / "mipmap-anydpi-v26"
adaptive.mkdir(exist_ok=True)
xml = '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/pokevoid_icon_background"/><foreground android:drawable="@drawable/pokevoid_icon_foreground"/></adaptive-icon>\n'
for name in ("ic_launcher.xml","ic_launcher_round.xml"):
    (adaptive / name).write_text(xml, encoding="utf-8")
manifest = resources.parent / "AndroidManifest.xml"
if manifest.is_file():
    text = manifest.read_text(encoding="utf-8")
    for attribute, value in (("icon","@mipmap/ic_launcher"),("roundIcon","@mipmap/ic_launcher_round")):
        text, count = re.subn('android:' + attribute + '="[^"]+"', 'android:' + attribute + '="' + value + '"', text, count=1)
        if count != 1:
            raise ValueError("Generated manifest icon attributes changed")
    manifest.write_text(text, encoding="utf-8")
print("PNG launcher artwork installed at all Android densities, including adaptive icons")
