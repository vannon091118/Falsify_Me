#!/usr/bin/env python
"""OCR fuer FalsifyMe-Screenshots (pytesseract + PIL, lokal auf dem System).

Nutzung: python ocr.py <bild1.png> [bild2.png ...]
- Skaliert UI-Text 2x hoch (Tesseract liest kleine Konsolen-Zeichen deutlich
  besser), kontrastiert und erkennt mit psm 6 (uniform block).
"""
import sys
from PIL import Image, ImageOps
import pytesseract

pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"

for path in sys.argv[1:]:
    img = Image.open(path).convert("L")
    img = img.resize((img.width * 2, img.height * 2), Image.LANCZOS)
    img = ImageOps.autocontrast(img)
    txt = pytesseract.image_to_string(img, lang="eng", config="--psm 6")
    print(f"════ {path} ════")
    print(txt)
    print()
