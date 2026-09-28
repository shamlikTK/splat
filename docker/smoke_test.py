# splatsite/docker/smoke_test.py — runs at image build (no GPU there), so CUDA parts are import-only.
import importlib
import subprocess
import sys

for m in ("pycolmap", "torch", "gsplat", "cv2", "plyfile", "onnxruntime", "omegaconf", "safetensors", "timm"):
    importlib.import_module(m); print("ok", m)
import torch  # noqa: E402
print("torch", torch.__version__, "cuda build", torch.version.cuda)
sys.path.insert(0, "/opt/splatsite/tools/worldmirror")
import hyworld2.worldrecon.pipeline  # noqa: E402,F401
print("ok worldmirror")
subprocess.run(["/opt/colmap/bin/colmap", "-h"], check=True, capture_output=True); print("ok colmap")
subprocess.run(["splat-transform", "--version"], check=True); print("ok splat-transform")
