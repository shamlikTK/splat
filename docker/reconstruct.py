#!/usr/bin/env python3
"""reconstruct: video -> scene folder, inside the splatsite image. Scene contract: see the spec."""
import argparse
import os
import shlex
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(os.environ.get("SPLATSITE_ROOT", "/opt/splatsite"))   # holds pipeline/, .venv/, tools/
P = ROOT / "pipeline"
PY = str(ROOT / ".venv" / "bin" / "python")
SCENE = "scene"


class Refused(Exception):
    pass


@dataclass
class Stage:
    name: str
    argv: list
    env: dict = field(default_factory=dict)
    inputs: list = field(default_factory=list)
    outputs: list = field(default_factory=list)
    # Alternative complete output sets: fresh if ANY group's files all exist (instead of requiring
    # `outputs`). Used by "publish", which writes either capture.sog or capture.ply + sog-pending
    # depending on whether a GPU SOG encoder was available (see pipeline/publish_tiers.sh).
    outputs_any: list = field(default_factory=list)


def detect_device() -> str:
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except Exception:  # noqa: BLE001
        return "cpu"


def plan(quality: str, device: str, scale: int, frames, out="/work"):
    if quality not in ("fast", "balanced", "high"):
        raise Refused(f"unknown quality '{quality}' (use fast, balanced or high)")
    if device == "cpu" and quality != "fast":
        raise Refused(f"quality '{quality}' needs an NVIDIA GPU (Gaussian-splat training is CUDA-only) and this host has none. "
                      "Use --quality fast, or run on a GPU machine.")
    if not (20 <= scale <= 100):
        raise Refused(f"--scale {scale} is out of range — pass an integer between 20 and 100 (percent of frame width)")
    if frames is not None and frames < 1:
        raise Refused(f"--frames {frames} is invalid — pass an integer of 1 or more")
    video = "/input/video"
    out_str = str(out)
    out_sh = shlex.quote(out_str)  # for interpolation into a `bash -c` command string below
    S = f"{ROOT}/work/{SCENE}"
    st = []
    if quality == "high":
        n = frames or 280
        st += [Stage("frames", ["bash", f"{P}/01_frames.sh", video, SCENE, str(n), str(scale)], {}, [], ["images"]),
               Stage("poses", ["bash", f"{P}/02_poses.sh", SCENE], {}, ["images"], ["sparse/0/images.bin"]),
               Stage("train", ["bash", f"{P}/03_train.sh", SCENE, "30000"], {}, ["sparse/0/images.bin"], ["splat.ply"])]
    else:
        cpu = device == "cpu"
        n = frames or (16 if cpu else 32)
        env = {"WM_TARGET": "700" if cpu else "952", "WM_MAX_GS": "3000000",
               "WM_SKY": "model" if cpu else "auto", "WM_MIN_FREE_GB": "0" if cpu else "18"}
        st += [Stage("frames", ["bash", f"{P}/01_frames.sh", video, SCENE, str(n), str(scale)], {}, [], ["images"])]
        if quality == "balanced":
            st += [Stage("worldmirror", ["bash", f"{P}/02b_worldmirror.sh", SCENE, "--colmap"], env, ["images"], ["sparse/0/images.bin"]),
                   Stage("train", ["bash", f"{P}/03_train.sh", SCENE, "5000"], {}, ["sparse/0/images.bin"], ["splat.ply"])]
        else:
            st += [Stage("worldmirror", ["bash", f"{P}/02b_worldmirror.sh", SCENE], env, ["images"], ["splat.ply"])]
    st += [Stage("publish", ["bash", f"{P}/publish_tiers.sh", f"{S}/splat.ply", out_str, "capture"], {}, ["splat.ply"], [],
                 outputs_any=[[f"{out_str}/capture.sog"], [f"{out_str}/capture.ply", f"{out_str}/sog-pending"]]),
           Stage("cameras", ["bash", "-c", f"{PY} {P}/scene_bounds.py {S}/splat.ply {out_sh}/bounds.json && {PY} {P}/export_cameras.py {S} {out_sh}/cameras.json"],
                 {}, ["splat.ply"], [f"{out_str}/cameras.json"]),
           Stage("manifest", [PY, f"{P}/derive_frame.py", f"{out_str}/cameras.json", f"{out_str}/bounds.json", f"{out_str}/manifest.json"],
                 {}, [f"{out_str}/cameras.json"], [f"{out_str}/manifest.json"])]
    if device == "cuda":
        st += [Stage("posters", ["bash", "-c", f"mkdir -p {out_sh}/posters && {PY} {P}/render_view.py {SCENE} 0 {out_sh}/posters/desktop.jpg 1440 900 0 52 {out_sh} "
                                              f"&& {PY} {P}/render_view.py {SCENE} 0 {out_sh}/posters/mobile.jpg 780 1688 0 64 {out_sh}"],
                     {}, [f"{out_str}/cameras.json"], [f"{out_str}/posters/desktop.jpg"])]
    return st


def prepare(work: Path, video: Path, root: Path, input_dir: Path = Path("/input")) -> None:
    """Create output directory structure and symlinks for pipeline access."""
    work = Path(work)
    (work / "stages").mkdir(parents=True, exist_ok=True)
    link = root / "work" / SCENE
    link.parent.mkdir(parents=True, exist_ok=True)
    if link.is_symlink():
        link.unlink()
    elif link.exists():
        shutil.rmtree(link)
    link.symlink_to(work / "stages")
    input_dir.mkdir(exist_ok=True)
    vid = input_dir / "video"
    if vid.is_symlink() or vid.exists():
        vid.unlink()
    vid.symlink_to(video.resolve())


def _path(work: Path, p: str) -> Path:
    return Path(p) if p.startswith("/") else work / "stages" / p


def run(stages, work, log_path, runner=subprocess.run):
    work = Path(work)
    (work / "stages").mkdir(parents=True, exist_ok=True)
    with open(log_path, "a", buffering=1) as log:
        for s in stages:
            ins = [_path(work, i) for i in s.inputs]
            marker = work / "stages" / f"{s.name}.done"
            if s.outputs_any:
                outputs_ok = any(all(_path(work, o).exists() for o in group) for group in s.outputs_any)
            else:
                outputs_ok = all(_path(work, o).exists() for o in s.outputs)
            fresh = marker.exists() and outputs_ok and \
                all(marker.stat().st_mtime >= i.stat().st_mtime for i in ins if i.exists())
            if fresh:
                print(f"== {s.name}: up to date, skipped"); log.write(f"== {s.name}: skipped\n"); continue
            print(f"== {s.name}"); log.write(f"== {s.name} ==\n"); t0 = time.time()
            r = runner(s.argv, env={**os.environ, **s.env, "PYTHONUNBUFFERED": "1"}, stdout=log, stderr=subprocess.STDOUT, text=True)
            if r.returncode != 0:
                sys.exit(f"!! stage {s.name} failed (exit {r.returncode}); see {log_path}. Fix the cause and rerun: finished stages are kept.")
            marker.touch()
            print(f"   done in {time.time() - t0:.0f}s")


def main() -> None:
    ap = argparse.ArgumentParser(prog="reconstruct")
    ap.add_argument("video")
    ap.add_argument("--quality", required=True)
    ap.add_argument("--scale", type=int, default=100)
    ap.add_argument("--frames", type=int)
    ap.add_argument("--out", default="/work")
    ap.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    a = ap.parse_args()
    device = detect_device() if a.device == "auto" else a.device
    work = Path(a.out).resolve()
    prepare(work, Path(a.video), ROOT)
    print(f"splatsite reconstruct: quality={a.quality} device={device} scale={a.scale}% out={work}")
    try:
        stages = plan(a.quality, device, a.scale, a.frames, out=work)
    except Refused as e:
        print(f"refused: {e}", file=sys.stderr); sys.exit(2)
    if device == "cpu":
        print("!! no GPU: fast quality at 16 frames / 700 px; expect 10-30 minutes on a laptop CPU")
    run(stages, work, work / "reconstruct.log")
    print("done:", ", ".join(p.name for p in sorted(work.iterdir()) if p.name != "stages"))


if __name__ == "__main__":
    main()
