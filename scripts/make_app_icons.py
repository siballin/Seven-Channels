#!/usr/bin/env python3
"""Draw the app icons in assets/app/ (a retro TV with a 7 on the screen). Run again after changing the design."""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "app")
FONT = "/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"


def draw(size, padding):
    """padding: fraction of the canvas kept clear on each side (maskable icons need ~10%+ for the safe zone)."""
    scale = 4  # draw large, then downsample for smooth edges
    s = size * scale
    image = Image.new("RGBA", (s, s), (17, 21, 29, 255))
    d = ImageDraw.Draw(image)
    # Soft background glow, blended on its own layer.
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    for i in range(40):
        r = s * (0.62 - i * 0.012)
        gd.ellipse([s / 2 - r, s * 0.56 - r, s / 2 + r, s * 0.56 + r], fill=(115, 150, 255, 4))
    image = Image.alpha_composite(image, glow)
    d = ImageDraw.Draw(image)
    inner = s * (1 - 2 * padding)
    left = s * padding
    top = s * padding
    # Antennas.
    width = max(2, int(inner * 0.035))
    cx = s / 2
    d.line([cx, top + inner * 0.24, cx - inner * 0.2, top + inner * 0.03], fill=(230, 234, 245, 255), width=width)
    d.line([cx, top + inner * 0.24, cx + inner * 0.2, top + inner * 0.03], fill=(230, 234, 245, 255), width=width)
    # TV body.
    body = [left + inner * 0.04, top + inner * 0.24, left + inner * 0.96, top + inner * 0.94]
    d.rounded_rectangle(body, radius=inner * 0.12, fill=(38, 44, 60, 255), outline=(230, 234, 245, 255), width=width)
    # Screen with a gradient.
    screen = [body[0] + inner * 0.07, body[1] + inner * 0.07, body[2] - inner * 0.07, body[3] - inner * 0.07]
    gradient = Image.new("RGBA", (int(screen[2] - screen[0]), int(screen[3] - screen[1])))
    gd = ImageDraw.Draw(gradient)
    h = gradient.height
    for y in range(h):
        t = y / max(1, h - 1)
        color = (int(115 + (224 - 115) * t), int(150 + (138 - 150) * t), int(255 + (255 - 255) * t), 255)
        gd.line([0, y, gradient.width, y], fill=color)
    mask = Image.new("L", gradient.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, gradient.width - 1, gradient.height - 1], radius=inner * 0.07, fill=255)
    image.paste(gradient, (int(screen[0]), int(screen[1])), mask)
    # The 7.
    font = ImageFont.truetype(FONT, int(inner * 0.5))
    text = "7"
    box = d.textbbox((0, 0), text, font=font)
    tx = (screen[0] + screen[2]) / 2 - (box[0] + box[2]) / 2
    ty = (screen[1] + screen[3]) / 2 - (box[1] + box[3]) / 2
    d.text((tx + inner * 0.012, ty + inner * 0.012), text, font=font, fill=(17, 21, 29, 120))
    d.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))
    return image.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    draw(192, 0.1).save(os.path.join(OUT, "icon-192.png"))
    draw(512, 0.1).save(os.path.join(OUT, "icon-512.png"))
    draw(512, 0.2).save(os.path.join(OUT, "maskable-512.png"))
    draw(180, 0.12).convert("RGB").save(os.path.join(OUT, "apple-touch-icon.png"))
    draw(48, 0.04).save(os.path.join(OUT, "favicon-48.png"))
    print("icons written to", OUT)


if __name__ == "__main__":
    main()
