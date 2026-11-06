"""首らくのアプリアイコン。小さな表示でも頭とスマホが読める平面構成。"""
from PIL import Image, ImageDraw

SAGE = (47, 109, 86, 255)
SAGE_DEEP = (30, 74, 58, 255)
CREAM = (246, 241, 232, 255)
PEACH = (240, 198, 168, 255)
AMBER = (224, 154, 74, 255)
SCREEN = (232, 244, 236, 255)


def layer(size):
    return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def phone_sprite(scale):
    w, h = int(168 * scale), int(292 * scale)
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = int(34 * scale)
    d.rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=CREAM)
    inset = int(14 * scale)
    d.rounded_rectangle(
        (inset, int(22 * scale), w - 1 - inset, h - 1 - int(36 * scale)),
        radius=int(16 * scale),
        fill=SAGE_DEEP,
    )
    d.rounded_rectangle(
        (inset + int(8 * scale), int(34 * scale), w - 1 - inset - int(8 * scale), h - 1 - int(52 * scale)),
        radius=int(10 * scale),
        fill=SCREEN,
    )
    dot = int(10 * scale)
    cx, cy = w // 2, h - int(20 * scale)
    d.ellipse((cx - dot, cy - dot, cx + dot, cy + dot), fill=(226, 216, 200, 255))
    return img.rotate(16, expand=True, resample=Image.Resampling.BICUBIC)


def draw_mark(size, pad_ratio):
    img = Image.new("RGBA", (size, size), SAGE)
    inner = int(size * (1 - pad_ratio * 2))
    ox = (size - inner) // 2
    oy = (size - inner) // 2
    scale = inner / 1024

    def P(x, y):
        return (ox + x * scale, oy + y * scale)

    # 角度を上げる弧
    arc = layer(size)
    ad = ImageDraw.Draw(arc)
    box = (*P(150, 150), *P(760, 760))
    ad.arc(box, start=200, end=330, fill=AMBER, width=max(6, int(28 * scale)))
    img = Image.alpha_composite(img, arc)

    fig = layer(size)
    d = ImageDraw.Draw(fig)
    # 肩は幅広く低く、頭は丸く小さく。雪だるまに見えない比率にする。
    d.pieslice((*P(180, 560), *P(780, 1160)), 200, 340, fill=PEACH)
    d.rounded_rectangle((*P(430, 470), *P(560, 680)), radius=int(40 * scale), fill=PEACH)
    d.ellipse((*P(330, 200), *P(630, 500)), fill=PEACH)
    d.ellipse((*P(530, 300), *P(690, 450)), fill=PEACH)
    d.ellipse((*P(500, 400), *P(640, 530)), fill=PEACH)
    eye = max(4, int(12 * scale))
    ex, ey = P(470, 340)
    d.ellipse((ex - eye, ey - eye, ex + eye, ey + eye), fill=SAGE_DEEP)
    # スマホを支える手
    d.ellipse((*P(620, 520), *P(820, 740)), fill=PEACH)
    img = Image.alpha_composite(img, fig)

    phone = phone_sprite(scale * 0.92)
    px, py = P(600, 250)
    img.alpha_composite(phone, (int(px), int(py)))
    return img.convert("RGB")


def save_all():
    any_icon = draw_mark(1024, 0.08)
    mask = draw_mark(1024, 0.18)
    any_icon.resize((512, 512), Image.Resampling.LANCZOS).save("icon-512.png", "PNG")
    any_icon.resize((192, 192), Image.Resampling.LANCZOS).save("icon-192.png", "PNG")
    any_icon.resize((180, 180), Image.Resampling.LANCZOS).save("icon-180.png", "PNG")
    mask.resize((512, 512), Image.Resampling.LANCZOS).save("icon-maskable-512.png", "PNG")
    any_icon.resize((256, 256), Image.Resampling.LANCZOS).save("icon-preview.png", "PNG")


if __name__ == "__main__":
    save_all()
