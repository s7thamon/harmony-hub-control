# Melodious icon

- `melodious-icon-source.jpg`: the original artwork.
- `melodious-playstore-512.png`: the Play Store icon (512 × 512).
- `build_icon.py` + `icon_tools.py`: regenerate every Android icon from the artwork with only numpy
  (no Pillow). They extract the neon glyph with its glow, fit it to the adaptive-icon safe zone and write:
  - `mipmap-*/ic_launcher_foreground.png`: colour glyph (background layer is `drawable/ic_launcher_background.xml`)
  - `mipmap-*/ic_launcher_monochrome.png`: strokes only, for Android themed icons
  - `drawable-*/ic_stat_melodious.png`: notification and Quick Settings icon

```sh
sips -s format bmp melodious-icon-source.jpg --out /tmp/melodious.bmp
python3 -I build_icon.py /tmp/melodious.bmp ../app/src/main/res .
```
