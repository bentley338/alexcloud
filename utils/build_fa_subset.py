#!/usr/bin/env python3
"""One-off build: subset FontAwesome 6.5.0 to only the icons used by AlexCloud
and emit a self-hosted CSS + woff2 set. Run from /tmp/fa where the original
all.min.css + woff2 files were downloaded. Writes output into the repo's public/.
"""
import re, os, subprocess, sys

SRC = os.environ.get("FA_SRC", r"C:\Users\bentl\AppData\Local\Temp\fa")
REPO = r"C:\project\alexcloud"
FONTS_OUT = os.path.join(REPO, "public", "fonts")
CSS_OUT = os.path.join(REPO, "public", "css", "fontawesome.min.css")

# Icons actually referenced anywhere in views/ + public/js/ (see grep audit)
BRANDS = {"chrome","edge","firefox","safari","instagram","telegram","tiktok","whatsapp"}
REGULAR = {"clock","comments"}  # the only `far` usages
SOLID = {
 "align-left","arrow-down","arrow-left","arrow-up","bell","bolt","box","calendar",
 "chart-line","check","check-circle","chevron-down","chevron-left","chevron-right",
 "circle","circle-notch","clock","cloud","cloud-upload-alt","cog","comments",
 "comment-slash","copy","dollar-sign","edit","envelope","exclamation-circle",
 "exclamation-triangle","external-link-alt","eye","eye-slash","gamepad",
 "grip-horizontal","heartbeat","history","home","id-card","image","images","inbox",
 "info-circle","laptop","lightbulb","link","list","lock","magic","mobile-alt",
 "money-bill","paper-plane","play","plus","plus-circle","qrcode","question-circle",
 "receipt","redo","robot","rocket","save","search","shield-alt","shield-check",
 "shield-halved","shopping-cart","sign-in-alt","sign-out-alt","spinner","star",
 "store","sync-alt","table","tablet-alt","tachometer-alt","tag","tags","th-large",
 "times","times-circle","trash","tv","upload","user","user-plus","users",
 "wave-square","wifi",
}

css = open(os.path.join(SRC, "all.min.css"), encoding="utf-8").read()

# name -> codepoint(hex). FA6 groups aliases in one rule:
#   .fa-bolt:before,.fa-zap:before{content:"\f0e7"}
# so capture EVERY fa-name in the selector list preceding each content block.
cp = {}
for selectors, code in re.findall(r'([^{}]*?)\{\s*content:\s*"\\([0-9a-fA-F]+)"\s*\}', css):
    for name in re.findall(r'\.fa-([a-z0-9-]+):', selectors):
        cp.setdefault(name, code.lower())

def codes(names):
    out, missing = [], []
    for n in names:
        if n in cp:
            out.append(cp[n])
        else:
            missing.append(n)
    return out, missing

def subset(infile, outfile, hexcodes):
    unis = ",".join("U+" + h for h in sorted(set(hexcodes)))
    cmd = [sys.executable, "-m", "fontTools.subset", os.path.join(SRC, infile),
           "--unicodes=" + unis, "--flavor=woff2",
           "--output-file=" + os.path.join(FONTS_OUT, outfile),
           "--no-hinting", "--desubroutinize"]
    subprocess.run(cmd, check=True)
    sz = os.path.getsize(os.path.join(FONTS_OUT, outfile))
    print(f"  {outfile}: {sz} bytes ({len(set(hexcodes))} glyphs)")

os.makedirs(FONTS_OUT, exist_ok=True)

sc, sm = codes(SOLID)
bc, bm = codes(BRANDS)
rc, rm = codes(REGULAR)
missing = sm + bm + rm
if missing:
    print("WARNING missing codepoints for:", missing)

print("Subsetting fonts...")
subset("fa-solid-900.woff2", "fa-solid-900.woff2", sc)
subset("fa-brands-400.woff2", "fa-brands-400.woff2", bc)
subset("fa-regular-400.woff2", "fa-regular-400.woff2", rc)

# Build minimal self-hosted CSS: base rules + @font-face (local) + used icon glyphs.
base = (
  ":root{--fa-style-family:'Font Awesome 6 Free';--fa-font-solid:normal 900 1em/1 'Font Awesome 6 Free';"
  "--fa-font-regular:normal 400 1em/1 'Font Awesome 6 Free';--fa-font-brands:normal 400 1em/1 'Font Awesome 6 Brands';"
  "--fa-display:inline-block}"
  ".fa,.fas,.far,.fab,.fa-solid,.fa-regular,.fa-brands{-moz-osx-font-smoothing:grayscale;"
  "-webkit-font-smoothing:antialiased;display:var(--fa-display,inline-block);font-style:normal;"
  "font-variant:normal;line-height:1;text-rendering:auto}"
  ".fas,.fa-solid{font-weight:900;font-family:'Font Awesome 6 Free'}"
  ".far,.fa-regular{font-weight:400;font-family:'Font Awesome 6 Free'}"
  ".fab,.fa-brands{font-weight:400;font-family:'Font Awesome 6 Brands'}"
)
faces = (
  "@font-face{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:900;font-display:swap;"
  "src:url(/fonts/fa-solid-900.woff2) format('woff2')}"
  "@font-face{font-family:'Font Awesome 6 Free';font-style:normal;font-weight:400;font-display:swap;"
  "src:url(/fonts/fa-regular-400.woff2) format('woff2')}"
  "@font-face{font-family:'Font Awesome 6 Brands';font-style:normal;font-weight:400;font-display:swap;"
  "src:url(/fonts/fa-brands-400.woff2) format('woff2')}"
)
glyphs = "".join(
  f'.fa-{n}:before{{content:"\\{cp[n]}"}}'
  for n in sorted(SOLID | BRANDS | REGULAR) if n in cp
)
open(CSS_OUT, "w", encoding="utf-8", newline="").write(base + faces + glyphs)
print("CSS written:", CSS_OUT, os.path.getsize(CSS_OUT), "bytes")
