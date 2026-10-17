"""SkillBridge explainer: cut loading, speed up, zoom to the point, caption, title + closing cards.

python render.py [out.mp4] [--only N[,N]] [--fast]
"""
import subprocess, sys, os, math, collections
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

FF = r"C:\Users\s12487\AppData\Roaming\Python\Python314\site-packages\imageio_ffmpeg\binaries\ffmpeg-win-x86_64-v7.1.exe"
SRC = r"C:\app\projects\skillbridge\video"
LOGO = r"C:\app\projects\skillbridge\docs\pitch\img\ai-elevate-logo.png"
FONTS = r"C:\Windows\Fonts"
W, H, FPS = 1920, 1080, 30
WX, WY, WW, WH = 144, 26, 1632, 918          # video window
CAP_Y = WY + WH                               # caption band top (944)

# colours (app palette)
BLUE, VIOLET, GOLD = (78, 168, 255), (139, 123, 255), (245, 200, 76)
TXT, MUTED, DIM = (240, 244, 255), (196, 206, 234), (128, 142, 180)

OBS = dict(crop=None, label=None)                         # OBS full-screen capture, 1280x720
TEAMS = dict(crop=(6, 19, 1254, 699), label=(0, 681, 214, 18))   # strip the Teams toolbar; paint over the name label

CLIPS = {
    "01": ("01graphic introduction.mkv", OBS),
    "02f": ("02-3Dflyview.mkv", TEAMS),
    "02h": ("02hidden talent.mkv", OBS),
    "03": ("03expert to re-engage.mkv", OBS),
    "04": ("04Collaboration Bridge.mkv", OBS),
    "05": ("05Rising Star.mkv", OBS),
    "06": ("06aDeploy AI Customer.mkv", TEAMS),
    "07": ("07Agent.mkv", TEAMS),
    "08": ("08Value Dashboard.mkv", TEAMS),
}

CHAPTERS = [
    "The living capability graph",
    "AI-inferred skills, in 3D",
    "Hidden talent",
    "Experts to re-engage",
    "Collaboration bridges",
    "Rising stars",
    "Build a team in one sentence",
    "Agentic AI",
    "Value dashboard",
]

FULL = (1.0, .5, .5)
# (chapter, clip, start, end, speed, zoom_from, zoom_to, caption)   zoom = (scale, cx, cy) on the source frame
SEGS = [
    (1, "01", 1.55, 3.45, 0.75, FULL, (1.08, .46, .5), "300 people, projects and systems, clustered by real work, not the org chart."),
    (1, "01", 17.0, 25.9, 2.0, (1.35, .62, .5), (1.4, .63, .5), "Click anyone to walk the graph: who they worked with, and on what."),
    (1, "01", 32.5, 44.4, 2.2, (1.35, .62, .5), (1.4, .63, .5), "Projects, systems and knowledge are all linked by evidence."),
    (2, "02f", 0.3, 5.2, 1.4, FULL, (1.1, .5, .46), "AI reads the work records and finds skills nobody declared."),
    (2, "02f", 7.6, 14.6, 1.15, (1.4, .6, .5), (1.5, .64, .5), "Each inferred skill shows its confidence and evidence. Dashed lines are AI-inferred."),
    (2, "02f", 15.0, 29.8, 1.9, FULL, (1.06, .5, .5), "3D Fly: orbit the same graph in depth. Gold links are AI-inferred skills."),
    (3, "02h", 1.5, 12.0, 1.5, FULL, (1.4, .64, .45), "High contribution, low visibility: the people the org chart misses. Opt-in only."),
    (3, "02h", 20.6, 24.4, 1.3, (1.2, .55, .5), (1.2, .55, .5), "Dive into a person to see the work behind the signal."),
    (3, "02h", 36.0, 38.3, 0.9, (1.45, .66, .45), (1.5, .67, .44), "Dive into a person to see the work behind the signal."),
    (4, "03", 6.0, 8.7, 1.3, FULL, FULL, "Proven experts whose work is still reused, but who have gone quiet."),
    (4, "03", 40.5, 51.0, 1.3, FULL, (1.4, .64, .45), "Invite them back as reviewers or mentors, before the knowledge walks out."),
    (5, "04", 4.1, 7.2, 1.3, FULL, FULL, "Who connects teams that would otherwise not talk?"),
    (5, "04", 17.8, 26.4, 1.5, (1.35, .62, .48), (1.4, .63, .48), "Lose a bridge and whole teams stop talking. Ranked from real collaboration paths."),
    (5, "04", 29.6, 44.4, 2.0, (1.2, .55, .5), (1.25, .57, .5), "Show on graph: see exactly which teams each bridge links."),
    (6, "05", 5.3, 8.4, 1.3, FULL, FULL, "Whose contribution is growing fastest?"),
    (6, "05", 47.3, 58.9, 1.6, (1.35, .62, .48), (1.4, .63, .48), "Growth you can see before the appraisal cycle does: 2025 vs 2026 contribution."),
    (6, "05", 67.3, 71.6, 1.1, (1.4, .64, .45), (1.45, .65, .44), "Growth paths: roles they are ready for now, and the smallest step to the next."),
    (7, "06", 1.8, 8.6, 1.4, (1.7, .3, .24), FULL, "Ask in plain language: \u201cBuild a team to deploy an AI customer-service solution.\u201d"),
    (7, "06", 8.7, 20.0, 2.0, (1.4, .64, .5), (1.45, .65, .55), "An internal team, the capability gap and the value, in seconds."),
    (7, "06", 22.6, 26.4, 1.0, (1.5, .4, .35), (1.55, .4, .35), "Challenge Team: one team match score, explained in four parts."),
    (7, "06", 29.0, 41.6, 1.7, (1.7, .66, .66), (1.7, .66, .66), "Swap anyone: let AI pick the next best match, or name a person yourself."),
    (7, "06", 44.0, 51.4, 1.7, (1.25, .45, .55), (1.3, .45, .55), "See how the team covers every required skill. Gaps show in red."),
    (7, "06", 52.0, 56.5, 1.0, (1.35, .62, .75), (1.4, .63, .75), "Activate Team: the value is recorded, ready for reinvestment."),
    (8, "07", 2.6, 8.2, 1.2, FULL, (1.45, .64, .42), "Five AI agents watch the data. Nobody has to ask."),
    (8, "07", 10.2, 17.6, 2.2, (1.45, .66, .5), (1.45, .66, .5), "Every agent shows its triggers, tools, AI step and human approver."),
    (8, "07", 21.4, 28.6, 1.15, (1.25, .6, .7), (1.25, .6, .7), "A consultancy purchase request lands in the data. The agents react in seconds."),
    (8, "07", 31.2, 41.8, 1.4, (1.55, .68, .6), (1.6, .69, .62), "Opportunity Scout: staff it internally and save $168k. Agents propose, people decide."),
    (9, "08", 3.0, 12.8, 1.3, FULL, (1.5, .42, .3), "Every activation adds up: $1.76M of value unlocked."),
    (9, "08", 13.0, 17.0, 0.9, (1.6, .36, .6), (1.75, .36, .62), "Savings flow into future capability: innovation, AI skills, reskilling."),
    (9, "08", 17.8, 25.8, 1.5, (1.3, .45, .45), (1.3, .45, .5), "Each figure traces back to an auditable impact record."),
]

XF_IN, XF_CH = 6, 12        # crossfade frames: within a chapter, between chapters / cards
INTRO_S, OUTRO_S = 4.2, 6.0


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), size)


F_TITLE = font("seguisb.ttf", 34)
F_CAP = font("segoeui.ttf", 27)
F_CHIP = font("segoeuib.ttf", 19)
F_MARK = font("seguisb.ttf", 20)
F_SMALL = font("segoeui.ttf", 18)


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def grad_h(w, h, c0, c1):
    t = np.linspace(0, 1, w)[None, :, None]
    a = np.array(c0)[None, None, :] * (1 - t) + np.array(c1)[None, None, :] * t
    return Image.fromarray(np.repeat(a, h, axis=0).astype(np.uint8))


# ---------------------------------------------------------------- static layers
def make_background():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    base = np.zeros((H, W, 3), np.float32)
    top, bot = np.array([7, 11, 24]), np.array([10, 15, 33])
    base += top * (1 - y[..., None] / H) + bot * (y[..., None] / H)
    for (cx, cy, r, col, a) in [(0, 0, 900, BLUE, .16), (W, H, 1000, VIOLET, .14)]:
        d = np.sqrt((x - cx) ** 2 + (y - cy) ** 2) / r
        g = np.clip(1 - d, 0, 1) ** 2 * a
        base += g[..., None] * np.array(col)
    bg = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8))
    return bg


def window_chrome(bg):
    """Bake the window's shadow and frame into the background; return (bg, mask)."""
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((WX, WY + 14, WX + WW, WY + WH + 14), 18, fill=170)
    sh = sh.filter(ImageFilter.GaussianBlur(26))
    bg = Image.composite(Image.new("RGB", (W, H), (0, 0, 0)), bg, sh)
    d = ImageDraw.Draw(bg)
    d.rounded_rectangle((WX - 2, WY - 2, WX + WW + 1, WY + WH + 1), 18, outline=(52, 64, 102), width=2)
    mask = Image.new("L", (WW, WH), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, WW - 1, WH - 1), 16, fill=255)
    return bg, mask


def caption_layer(ch, text, total_ch):
    """RGBA band (W x H-CAP_Y): chapter chip + title, caption line, wordmark."""
    band = Image.new("RGBA", (W, H - CAP_Y), (0, 0, 0, 0))
    d = ImageDraw.Draw(band)
    y0 = 20
    chip = f"{ch:02d} / {total_ch:02d}"
    cw = d.textlength(chip, font=F_CHIP) + 26
    g = grad_h(int(cw), 32, BLUE, VIOLET).convert("RGBA")
    m = Image.new("L", g.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, g.size[0] - 1, 31), 16, fill=255)
    band.paste(g, (WX, y0 + 3), m)
    d.text((WX + 13, y0 + 4), chip, font=F_CHIP, fill=(255, 255, 255))
    d.text((WX + cw + 16, y0 - 6), CHAPTERS[ch - 1], font=F_TITLE, fill=TXT)
    f = F_CAP
    while d.textlength(text, font=f) > WW and f.size > 20:
        f = font("segoeui.ttf", f.size - 1)
    d.text((WX, y0 + 44), text, font=f, fill=MUTED)
    mark = "AI SkillBridge"
    mw = d.textlength(mark, font=F_MARK)
    d.text((WX + WW - mw, y0 + 2), mark, font=F_MARK, fill=(170, 182, 214))
    team = "Team Astra"
    tw = d.textlength(team, font=F_SMALL)
    d.ellipse((WX + WW - mw - tw - 30, y0 + 15, WX + WW - mw - tw - 24, y0 + 21), fill=GOLD)
    d.text((WX + WW - mw - tw - 16, y0 + 5), team, font=F_SMALL, fill=DIM)
    return band


def split_band(band):
    """Return (title part, caption part) so the caption line can animate on its own."""
    a = band.copy(); b = band.copy()
    ImageDraw.Draw(a).rectangle((0, 60, W, band.size[1]), fill=(0, 0, 0, 0))
    ImageDraw.Draw(b).rectangle((0, 0, W, 59), fill=(0, 0, 0, 0))
    return a, b


# ---------------------------------------------------------------- frame sources
def decode(seg):
    ch, key, a, b, spd = seg[:5]
    name, kind = CLIPS[key]
    vf = []
    if kind["crop"]:
        x, y, w, h = kind["crop"]
        vf.append(f"crop={w}:{h}:{x}:{y}")
    if kind["label"]:
        x, y, w, h = kind["label"]
        vf.append(f"drawbox=x={x}:y={y}:w={w}:h={h}:color=0x080b18:t=fill")
    vf += [f"setpts=(PTS-STARTPTS)/{spd}", f"fps={FPS}"]
    if kind["crop"]:
        vf.append("scale=1280:720:flags=lanczos")
    cmd = [FF, "-v", "error", "-ss", f"{a}", "-to", f"{b}", "-i", os.path.join(SRC, name),
           "-an", "-vf", ",".join(vf), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=10 ** 8)
    n = 1280 * 720 * 3
    while True:
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        yield Image.frombuffer("RGB", (1280, 720), buf, "raw", "RGB", 0, 1)
    p.wait()


def zoom_box(z, sw=1280, sh=720):
    s, cx, cy = z
    w, h = sw / s, sh / s
    x0 = min(max(cx * sw - w / 2, 0), sw - w)
    y0 = min(max(cy * sh - h / 2, 0), sh - h)
    return (x0, y0, x0 + w, y0 + h)


def seg_frames(seg, layers, mask, bg, title_fresh, fast):
    ch, key, a, b, spd, z0, z1, cap = seg
    n_est = max(1, round((b - a) / spd * FPS))
    title_l, cap_l = layers
    rs = Image.BILINEAR if fast else Image.LANCZOS
    for i, fr in enumerate(decode(seg)):
        e = ease(i / max(1, n_est - 1))
        z = tuple(z0[k] + (z1[k] - z0[k]) * e for k in range(3))
        win = fr.resize((WW, WH), rs, box=zoom_box(z))
        canvas = bg.copy()
        canvas.paste(win, (WX, WY), mask)
        t = i / FPS
        # caption line: fade + rise; title: fade only when the chapter changes
        ca = ease((t - 0.10) / 0.35)
        ta = ease(t / 0.35) if title_fresh else 1.0
        put_layer(canvas, title_l, ta, 0)
        put_layer(canvas, cap_l, ca, int((1 - ca) * 10))
        yield canvas


def put_layer(canvas, layer, alpha, dy):
    if alpha <= 0:
        return
    l = layer
    if alpha < 1:
        r, g, b, a = l.split()
        a = a.point(lambda v: int(v * alpha))
        l = Image.merge("RGBA", (r, g, b, a))
    canvas.paste(l, (0, CAP_Y + dy), l)


def text_center(d, y, s, f, fill):
    w = d.textlength(s, font=f)
    d.text(((W - w) / 2, y), s, font=f, fill=fill)


def card_frames(kind, bg_plain, seconds):
    logo = Image.open(LOGO).convert("RGBA")
    n = int(seconds * FPS)
    if kind == "intro":
        lw = 660
        logo = logo.resize((lw, int(logo.size[1] * lw / logo.size[0])), Image.LANCZOS)
        items = [
            ("img", logo, 230),
            ("txt", "AI SkillBridge", font("segoeuib.ttf", 92), TXT, 500),
            ("txt", "Connectivity intelligence for people, skills and work", font("segoeuil.ttf", 38), MUTED, 622),
            ("txt", "Team Astra  \u00b7  Product walkthrough", font("seguisb.ttf", 26), GOLD, 708),
        ]
    else:
        lw = 380
        logo = logo.resize((lw, int(logo.size[1] * lw / logo.size[0])), Image.LANCZOS)
        items = [
            ("txt", "Not just a people visibility tool.", font("segoeuil.ttf", 46), MUTED, 300),
            ("grad", "Connectivity intelligence.", font("segoeuib.ttf", 96), None, 372),
            ("txt", "One graph of people, skills, work and systems, ready for the next use case.", font("segoeui.ttf", 32), MUTED, 522),
            ("txt", "AI SkillBridge  \u00b7  Team Astra", font("seguisb.ttf", 28), TXT, 640),
            ("img", logo, 700),
        ]
    # pre-render each item as an RGBA full-width strip
    strips = []
    for it in items:
        if it[0] == "img":
            im = it[1]
            s = Image.new("RGBA", (W, im.size[1]), (0, 0, 0, 0))
            s.paste(im, ((W - im.size[0]) // 2, 0), im)
            strips.append((s, it[2]))
        else:
            _, s_, f, col, y = it
            bb = f.getbbox(s_)
            hh = bb[3] + 16
            s = Image.new("RGBA", (W, hh), (0, 0, 0, 0))
            d = ImageDraw.Draw(s)
            if it[0] == "grad":
                tw = d.textlength(s_, font=f)
                m = Image.new("L", (W, hh), 0)
                ImageDraw.Draw(m).text(((W - tw) / 2, 0), s_, font=f, fill=255)
                g = grad_h(W, hh, BLUE, VIOLET).convert("RGBA")
                s.paste(g, (0, 0), m)
            else:
                text_center(d, 0, s_, f, col)
            strips.append((s, y))
    for i in range(n):
        t = i / FPS
        c = bg_plain.copy()
        for k, (s, y) in enumerate(strips):
            a = ease((t - 0.15 - k * 0.18) / 0.5)
            if a > 0:
                ss = s
                if a < 1:
                    r, g, b, al = s.split()
                    ss = Image.merge("RGBA", (r, g, b, al.point(lambda v: int(v * a))))
                c.paste(ss, (0, y + int((1 - a) * 14)), ss)
        yield c


# ---------------------------------------------------------------- assembly
def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else "skillbridge-explainer.mp4"
    fast = "--fast" in args
    only = None
    if "--only" in args:
        only = {int(x) for x in args[args.index("--only") + 1].split(",")}
    bg_plain = make_background()
    bg_win, mask = window_chrome(bg_plain.copy())
    segs = [s for s in SEGS if not only or s[0] in only]

    if "--stills" in args:                    # first and last framed frame of every segment, for review
        tiles = []
        for s in segs:
            layers = split_band(caption_layer(s[0], s[7], len(CHAPTERS)))
            frames = list(seg_frames(s, layers, mask, bg_win, False, True))
            for f in (frames[min(15, len(frames) - 1)], frames[-1]):
                tiles.append(f.resize((640, 360), Image.BILINEAR))
        cols = 4
        rows = math.ceil(len(tiles) / cols)
        sheet = Image.new("RGB", (cols * 640, rows * 360))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * 640, (i // cols) * 360))
        sheet.save(out)
        return

    # shots: (frame generator factory, crossfade-in frames, est frames)
    shots = []
    if not only:
        shots.append((lambda: card_frames("intro", bg_plain, INTRO_S), 0, int(INTRO_S * FPS)))
    prev_ch = None
    for s in segs:
        layers = split_band(caption_layer(s[0], s[7], len(CHAPTERS)))
        fresh = s[0] != prev_ch
        xf = XF_CH if (fresh or prev_ch is None) else XF_IN
        if not shots:
            xf = 0
        shots.append(((lambda s=s, l=layers, f=fresh: seg_frames(s, l, mask, bg_win, f, fast)), xf,
                      max(1, round((s[3] - s[2]) / s[4] * FPS))))
        prev_ch = s[0]
    if not only:
        shots.append((lambda: card_frames("outro", bg_plain, OUTRO_S), XF_CH, int(OUTRO_S * FPS)))
    total_est = sum(n - xf for _, xf, n in shots)
    print(f"estimated {total_est / FPS:.1f}s, {len(shots)} shots", flush=True)

    # chapter boundaries for the progress bar ticks
    enc = subprocess.Popen([FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", str(FPS), "-i", "-", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
                            "-shortest", "-c:v", "libx264", "-preset", "veryfast" if fast else "slow",
                            "-crf", "26" if fast else "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
                            "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    written = 0
    tail = collections.deque()

    def emit(img):
        nonlocal written
        d = ImageDraw.Draw(img)
        p = min(1.0, written / max(1, total_est - 1))
        d.rectangle((0, H - 5, W, H), fill=(22, 30, 54))
        if p > 0:
            img.paste(grad_h(max(1, int(W * p)), 5, BLUE, VIOLET), (0, H - 5))
        enc.stdin.write(img.tobytes())
        written += 1

    for idx, (factory, xf, _) in enumerate(shots):
        gen = factory()
        k = 0
        buf = collections.deque()
        for fr in gen:
            if tail:                                  # crossfade with the previous shot's tail
                prev = tail.popleft()
                a = (k + 1) / (len(tail) + k + 2)
                fr_out = Image.blend(prev, fr, a)
                k += 1
                emit(fr_out)
                continue
            buf.append(fr)
            nxt_xf = shots[idx + 1][1] if idx + 1 < len(shots) else 0
            while len(buf) > nxt_xf:
                emit(buf.popleft())
        while tail:
            emit(tail.popleft())
        tail = buf
        print(f"shot {idx + 1}/{len(shots)} done, {written / FPS:.1f}s", flush=True)
    while tail:
        emit(tail.popleft())
    enc.stdin.close()
    enc.wait()
    print(f"wrote {out}: {written} frames = {written / FPS:.2f}s")


if __name__ == "__main__":
    main()
