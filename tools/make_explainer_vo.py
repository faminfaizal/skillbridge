"""SkillBridge explainer with an ElevenLabs voice-over, synchronised sentence by sentence.

Timing is driven by the voice: each section lasts as long as its clip (plus a short lead and tail), and every
video segment starts on the sentence it illustrates. Recorded app footage is sped up or slowed down to fit.

python make_explainer_vo.py [out.mp4] [--fast]
Clips live in video/vo/<key>.mp3. A missing clip renders silently with an estimated length (logged as MISSING).
"""
import collections, math, os, subprocess, sys, json
import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(__file__))
import make_explainer as M          # background, window chrome, captions, decoding, title and closing cards

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VO = os.path.join(ROOT, "video", "vo")
SCENES = os.path.join(ROOT, "video", "scenes")
WORK = os.environ.get("EXPLAINER_WORK", os.path.join(os.environ.get("TEMP", "."), "skillbridge-explainer"))
FPS, W, H = M.FPS, M.W, M.H
LEAD, TAIL = 0.40, 0.25            # voice starts as the crossfade completes; short breath before the next section
TEMPO = 1.03                       # voice played 3% faster (pitch kept) so the cut stays under 3:00
XF_IN, XF_SEC = 6, 12              # crossfade frames: between segments of a section, between sections
FULL = (1.0, .5, .5)

# Sections in order. sent = sentence start times inside the clip (seconds); est = length when the clip is missing.
# Chapter segments: (clip, src_start, src_end, zoom_from, zoom_to, caption, anchor). anchor = the clip time the
# segment starts on (first is 0); None shares the previous anchor's span in proportion to source length.
SECTIONS = [
    dict(key="hook", kind="scene", sent=[0, 5.29, 9.27]),
    dict(key="problem", kind="scene", sent=[0, 2.38, 4.78, 9.89]),
    dict(key="solution", kind="scene", sent=[0, 2.13, 4.24, 7.26]),
    dict(key="title", kind="card", card="intro", min=3.4),
    dict(key="c1", kind="chapter", ch=1, gaps={7.23: 0.5}, segs=[
        ("01", 1.55, 3.45, FULL, (1.08, .46, .5), "300 people, projects and systems, clustered by real work, not the org chart.", 0),
        ("01", 17.0, 25.9, (1.35, .62, .5), (1.4, .63, .5), "Click anyone to walk the graph: who they worked with, and on what.", 1.94),
        ("01", 32.5, 41.0, (1.35, .62, .5), (1.4, .63, .5), "Projects, systems and knowledge are all linked by evidence.", 7.23)]),
    dict(key="c2", kind="chapter", ch=2, segs=[
        ("02f", 0.3, 5.2, FULL, (1.1, .5, .46), "AI reads the work records and finds skills nobody declared.", 0),
        ("02f", 7.6, 14.6, (1.4, .6, .5), (1.5, .64, .5), "Each inferred skill shows its confidence and evidence. Dashed lines are AI-inferred.", 2.0),
        ("02f", 15.0, 26.0, FULL, (1.06, .5, .5), "3D Fly: orbit the same graph in depth. Gold links are AI-inferred skills.", 8.21)]),
    dict(key="c3", kind="chapter", ch=3, segs=[
        ("02h", 3.0, 10.0, FULL, (1.4, .64, .45), "High contribution, low visibility: the people the org chart misses. Opt-in only.", 0),
        ("02h", 20.6, 24.4, (1.2, .55, .5), (1.2, .55, .5), "Dive into a person to see the work behind the signal.", 4.25),
        ("02h", 36.0, 38.3, (1.45, .66, .45), (1.5, .67, .44), "Dive into a person to see the work behind the signal.", None)]),
    dict(key="c4", kind="chapter", ch=4, segs=[
        ("03", 6.0, 8.7, FULL, FULL, "Proven experts whose work is still reused, but who have gone quiet.", 0),
        ("03", 40.5, 51.0, FULL, (1.4, .64, .45), "Invite them back as reviewers or mentors, before the knowledge walks out.", 1.5)]),
    dict(key="c5", kind="chapter", ch=5, segs=[
        ("04", 4.1, 7.2, FULL, FULL, "Who connects teams that would otherwise not talk?", 0),
        ("04", 17.8, 26.4, (1.35, .62, .48), (1.4, .63, .48), "Lose a bridge and whole teams stop talking. Ranked from real collaboration paths.", 2.0),
        ("04", 29.6, 40.0, (1.2, .55, .5), (1.25, .57, .5), "Show on graph: see exactly which teams each bridge links.", 7.32)]),
    dict(key="c6", kind="chapter", ch=6, segs=[
        ("05", 5.3, 8.4, FULL, FULL, "Whose contribution is growing fastest?", 0),
        ("05", 47.3, 54.5, (1.35, .62, .48), (1.4, .63, .48), "Growth you can see before the appraisal cycle does: 2025 vs 2026 contribution.", 1.57),
        ("05", 67.3, 71.6, (1.4, .64, .45), (1.45, .65, .44), "Growth paths: roles they are ready for now, and the smallest step to the next.", 4.55)]),
    dict(key="c7", kind="chapter", ch=7, gaps={18.31: 1.4}, segs=[
        ("06", 1.8, 8.6, (1.7, .3, .24), FULL, "Ask in plain language: “Build a team to deploy an AI customer-service solution.”", 0),
        ("06", 8.7, 20.0, (1.4, .64, .5), (1.45, .65, .55), "An internal team, the capability gap and the value, in seconds.", 7.49),
        ("06", 22.6, 28.5, (1.5, .4, .35), (1.4, .42, .42), "Challenge Team: one team match score, explained in four parts.", 12.50),
        ("06", 33.0, 41.6, (1.7, .66, .66), (1.7, .66, .66), "Swap anyone: let AI pick the next best match, or name a person yourself.", 18.31),
        ("06", 44.0, 48.5, (1.25, .45, .55), (1.3, .45, .55), "See how the team covers every required skill. Gaps show in red.", None),
        ("06", 52.0, 56.5, (1.35, .62, .75), (1.4, .63, .75), "Activate Team: the value is recorded, ready for reinvestment.", 21.95)]),
    dict(key="c8", kind="chapter", ch=8, segs=[
        ("07", 2.6, 8.2, FULL, (1.45, .64, .42), "Five AI agents watch the data. Nobody has to ask.", 0),
        ("07", 10.2, 17.6, (1.45, .66, .5), (1.45, .66, .5), "Every agent shows its triggers, tools, AI step and human approver.", 2.65),
        ("07", 21.4, 28.6, (1.25, .6, .7), (1.25, .6, .7), "A consultancy purchase request lands in the data. The agents react in seconds.", 5.19),
        ("07", 31.2, 41.8, (1.55, .68, .6), (1.6, .69, .62), "Opportunity Scout: staff it internally and save $168k. Agents propose, people decide.", 9.08)]),
    dict(key="c9", kind="chapter", ch=9, segs=[
        ("08", 3.0, 12.8, FULL, (1.5, .42, .3), "Every activation adds up: $1.76M of value unlocked.", 0),
        ("08", 13.0, 17.0, (1.6, .36, .6), (1.75, .36, .62), "Savings flow into future capability: innovation, AI skills, reskilling.", 6.19),
        ("08", 17.8, 25.8, (1.3, .45, .45), (1.3, .45, .5), "Each figure traces back to an auditable impact record.", 10.44)]),
    dict(key="outro", kind="card", card="outro", min=6.0),
]
SPEED_MIN, SPEED_MAX = 0.6, 3.5


def ffprobe_len(path):
    o = subprocess.run([M.FF, "-hide_banner", "-i", path], capture_output=True, text=True).stderr
    h, m, s = o.split("Duration: ")[1].split(",")[0].split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def load_audio(path):
    p = subprocess.run([M.FF, "-v", "error", "-i", path, "-af", f"atempo={TEMPO}", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"], capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32).copy()


def plan():
    """Resolve every section's clip, length, gaps and local shot start times."""
    out = []
    for s in SECTIONS:
        clip = os.path.join(VO, s["key"] + ".mp3")
        have = os.path.exists(clip)
        length = (ffprobe_len(clip) if have else s.get("est", 0)) / TEMPO
        gaps = {at / TEMPO: g for at, g in s.get("gaps", {}).items()} if have else {}
        sent = [x / TEMPO for x in (s.get("sent") if have or "estsent" not in s else s["estsent"]) or [0]]
        def local(t):                      # clip time (before tempo) -> section-local output time
            t = t / TEMPO
            return LEAD + t + sum(g for at, g in gaps.items() if at <= t + 1e-6)
        D = max(s.get("min", 0), LEAD + length + sum(gaps.values()) + TAIL)
        shots = []
        if s["kind"] == "chapter":
            segs = s["segs"]
            anchors = []
            for i, sg in enumerate(segs):
                a = sg[6]
                anchors.append(0.0 if i == 0 else (None if a is None else local(a)))
            # fill None anchors proportionally between the surrounding anchored times
            i = 0
            while i < len(segs):
                j = i + 1
                while j < len(segs) and anchors[j] is None:
                    j += 1
                t0, t1 = anchors[i], (anchors[j] if j < len(segs) else D)
                srcs = [segs[k][2] - segs[k][1] for k in range(i, j)]
                acc = t0
                for k, ln in zip(range(i, j), srcs):
                    anchors[k] = acc; acc += (t1 - t0) * ln / sum(srcs)
                i = j
            for i, sg in enumerate(segs):
                shots.append(dict(kind="seg", seg=sg, ch=s["ch"], t=anchors[i]))
        else:
            shots.append(dict(kind=s["kind"], t=0.0, key=s["key"], card=s.get("card"),
                              sent=[LEAD + x for x in sent]))
        out.append(dict(sec=s, have=have, clip=clip, length=length, gaps=gaps, D=D, shots=shots))
    return out


def scene_frames(key, n, sent, fast):
    d = os.path.join(WORK, "scene-" + key)
    want = f"{n}|{','.join(f'{x:.3f}' for x in sent)}"
    stamp = os.path.join(d, "stamp.txt")
    if not (os.path.exists(stamp) and open(stamp).read() == want):
        if os.path.isdir(d):
            for f in os.listdir(d):
                os.remove(os.path.join(d, f))
        subprocess.run(["node", os.path.join(SCENES, "capture.mjs"), d, key, f"{n / FPS:.4f}", ",".join(f"{x:.3f}" for x in sent), str(FPS)], check=True)
        open(stamp, "w").write(want)
    files = sorted(f for f in os.listdir(d) if f.endswith(".jpg"))[:n]
    for f in files:
        yield Image.open(os.path.join(d, f)).convert("RGB")
    for _ in range(n - len(files)):
        yield Image.open(os.path.join(d, files[-1])).convert("RGB")


def seg_frames(sg, n, layers, mask, bg, title_fresh, fast):
    key, a, b, z0, z1, cap, _ = sg
    target = n / FPS
    spd = min(SPEED_MAX, max(SPEED_MIN, (b - a) / target))
    seg = (0, key, a, b, spd)
    title_l, cap_l = layers
    rs = Image.BILINEAR if fast else Image.LANCZOS
    last = None
    i = 0
    for fr in M.decode(seg):
        if i >= n:
            break
        e = M.ease(i / max(1, n - 1))
        z = tuple(z0[k] + (z1[k] - z0[k]) * e for k in range(3))
        last = fr.resize((M.WW, M.WH), rs, box=M.zoom_box(z))
        yield compose(last, i, layers, mask, bg, title_fresh)
        i += 1
    while i < n:                                   # source ran short at this speed: hold the last frame
        yield compose(last, i, layers, mask, bg, title_fresh)
        i += 1


def compose(win, i, layers, mask, bg, title_fresh):
    title_l, cap_l = layers
    canvas = bg.copy()
    canvas.paste(win, (M.WX, M.WY), mask)
    t = i / FPS
    ca = M.ease((t - 0.10) / 0.35)
    ta = M.ease(t / 0.35) if title_fresh else 1.0
    M.put_layer(canvas, title_l, ta, 0)
    M.put_layer(canvas, cap_l, ca, int((1 - ca) * 10))
    return canvas


def main():
    args = sys.argv[1:]
    out = args[0] if args and not args[0].startswith("--") else os.path.join(ROOT, "video", "SkillBridge_Explainer_VO.mp4")
    fast = "--fast" in args
    os.makedirs(WORK, exist_ok=True)
    P = plan()

    # absolute timeline (seconds): each section starts where the previous one ends
    T = 0.0
    shots = []                                     # (factory, n_frames, xf_in)
    audio_events = []
    bg_plain = M.make_background()
    bg_win, mask = M.window_chrome(bg_plain.copy())
    prev_ch = None
    report = []
    for si, p in enumerate(P):
        s = p["sec"]
        F0 = round(T * FPS)
        times = [sh["t"] for sh in p["shots"]] + [p["D"]]
        for k, sh in enumerate(p["shots"]):
            a_f = round((T + times[k]) * FPS) - F0
            b_f = round((T + times[k + 1]) * FPS) - F0
            last_shot = si == len(P) - 1 and k == len(p["shots"]) - 1
            xf_next = 0 if last_shot else (XF_IN if k + 1 < len(p["shots"]) else XF_SEC)
            xf_in = 0 if not shots else (XF_IN if k > 0 else XF_SEC)
            n = b_f - a_f + xf_next
            if sh["kind"] == "seg":
                sg = sh["seg"]
                fresh = sh["ch"] != prev_ch
                layers = M.split_band(M.caption_layer(sh["ch"], sg[5], len(M.CHAPTERS)))
                shots.append(((lambda sg=sg, n=n, l=layers, f=fresh: seg_frames(sg, n, l, mask, bg_win, f, fast)), n, xf_in))
                spd = (sg[2] - sg[1]) / (n / FPS)
                report.append(f"   {sg[0]} {sg[1]:5.1f}-{sg[2]:5.1f}s  at {T + times[k]:6.2f}s  {n / FPS:5.2f}s  speed {spd:4.2f}x"
                              + ("  (clamped)" if not SPEED_MIN <= spd <= SPEED_MAX else ""))
                prev_ch = sh["ch"]
            elif sh["kind"] == "scene":
                shots.append(((lambda key=sh["key"], n=n, sent=sh["sent"]: scene_frames(key, n, sent, fast)), n, xf_in))
            else:
                shots.append(((lambda c=sh["card"], n=n: M.card_frames(c, bg_plain, n / FPS)), n, xf_in))
        if p["have"]:
            audio_events.append((T + LEAD, p["clip"], p["gaps"]))
        report.insert(len(report) - len(p["shots"]) if s["kind"] == "chapter" else len(report),
                      f"{s['key']:9s} {T:6.2f}s  len {p['D']:5.2f}s  voice {p['length']:5.2f}s" + ("" if p["have"] else "  MISSING (silent, estimated)"))
        T += p["D"]
    total = T
    print("\n".join(report))
    print(f"total {total:.2f}s ({int(total // 60)}:{total % 60:05.2f})", flush=True)

    # ---------------------------------------------------------------- audio
    SR = 48000
    track = np.zeros(int((total + 1) * SR), np.float32)
    for start, clip, gaps in audio_events:
        x = load_audio(clip)
        cuts = sorted(gaps.items())
        pieces, prev, shift = [], 0.0, 0.0
        for at, g in cuts:
            pieces.append((prev, at, shift)); prev = at; shift += g
        pieces.append((prev, len(x) / SR, shift))
        for a, b, sh in pieces:
            seg = x[int(a * SR):int(b * SR)].copy()
            f = min(len(seg), int(0.012 * SR))         # 12 ms fades so splits never click
            if f:
                seg[:f] *= np.linspace(0, 1, f); seg[-f:] *= np.linspace(1, 0, f)
            o = int((start + a + sh) * SR)
            track[o:o + len(seg)] += seg[:max(0, len(track) - o)]
    track = track[:int(total * SR)]
    raw = os.path.join(WORK, "vo_raw.f32")
    track.tofile(raw)
    wav = os.path.join(WORK, "vo.wav")
    subprocess.run([M.FF, "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", raw,
                    "-af", f"loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=out:st={total - 0.6:.2f}:d=0.6", "-ar", str(SR), "-ac", "2", wav], check=True)

    # ---------------------------------------------------------------- video
    n_total = sum(n for _, n, _ in shots) - sum(x for _, _, x in shots)
    enc = subprocess.Popen([M.FF, "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                            "-i", wav, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "veryfast" if fast else "slow",
                            "-crf", "26" if fast else "17", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
                            "-movflags", "+faststart", out], stdin=subprocess.PIPE)
    written = 0

    def emit(img):
        nonlocal written
        d = ImageDraw.Draw(img)
        p = min(1.0, written / max(1, n_total - 1))
        d.rectangle((0, H - 5, W, H), fill=(22, 30, 54))
        if p > 0:
            img.paste(M.grad_h(max(1, int(W * p)), 5, M.BLUE, M.VIOLET), (0, H - 5))
        fade = min(1.0, written / 12, (n_total - 1 - written) / 20)        # from black, to black
        if fade < 1:
            img = Image.blend(Image.new("RGB", img.size), img, max(0.0, fade))
        enc.stdin.write(img.tobytes())
        written += 1

    tail = collections.deque()
    for idx, (factory, n, xf) in enumerate(shots):
        nxt = shots[idx + 1][2] if idx + 1 < len(shots) else 0
        k = 0
        buf = collections.deque()
        for fr in factory():
            if tail:
                prev = tail.popleft()
                emit(Image.blend(prev, fr, (k + 1) / (len(tail) + k + 2)))
                k += 1
                continue
            buf.append(fr)
            while len(buf) > nxt:
                emit(buf.popleft())
        while tail:
            emit(tail.popleft())
        tail = buf
        if idx % 4 == 3 or idx == len(shots) - 1:
            print(f"shot {idx + 1}/{len(shots)}: {written / FPS:.1f}s", flush=True)
    while tail:
        emit(tail.popleft())
    enc.stdin.close()
    enc.wait()
    print(f"wrote {out}: {written} frames = {written / FPS:.2f}s (planned {total:.2f}s)")


if __name__ == "__main__":
    main()
