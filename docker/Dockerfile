# splatsite/docker/Dockerfile — reconstruction image. Build from the repo root:
#   docker build -f splatsite/docker/Dockerfile -t splatsite-recon:dev .
FROM nvidia/cuda:13.0.1-cudnn-devel-ubuntu24.04
# TORCH_CUDA_ARCH_LIST contract: local builds default to "12.0" (this box is a DGX
# Spark, GB10, sm_121 -- a cubin built for compute capability 12.0 runs on any 12.x
# device per CUDA's binary-compat rule, so one arch is enough here). CI overrides
# this with --build-arg TORCH_CUDA_ARCH_LIST="8.0;8.6;8.9;9.0;12.0+PTX" to publish a
# portable multi-arch image (see .github/workflows/recon-image.yml).
ARG TORCH_CUDA_ARCH_LIST="12.0"
ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 HF_HOME=/weights SPLATSITE_ROOT=/opt/splatsite \
    PATH=/opt/splatsite/.venv/bin:/opt/colmap/bin:/usr/local/cuda/bin:$PATH TORCH_CUDA_ARCH_LIST=$TORCH_CUDA_ARCH_LIST
RUN apt-get update && apt-get install -y --no-install-recommends git curl ca-certificates ffmpeg bzip2 build-essential ninja-build \
      python3.12 python3.12-venv \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y nodejs \
    && npm i -g @playcanvas/splat-transform@3.4.2 && rm -rf /var/lib/apt/lists/*
COPY splatsite/docker/install_colmap.sh /tmp/
RUN bash /tmp/install_colmap.sh
RUN curl -LsSf https://astral.sh/uv/install.sh | sh && ln -s /root/.local/bin/uv /usr/local/bin/uv
WORKDIR /opt/splatsite
RUN uv venv --python 3.12 .venv \
    && uv pip install --python .venv/bin/python --index-url https://download.pytorch.org/whl/cu130 torch==2.14.0 torchvision==0.29.0 \
    && uv pip install --python .venv/bin/python numpy opencv-python-headless imageio imageio-ffmpeg tqdm pyyaml tyro viser scikit-learn pillow plyfile \
       torchmetrics tensorboard scipy splines piexif matplotlib tensorly omegaconf huggingface_hub safetensors einops timm transformers loguru trimesh scikit-image onnxruntime \
       "git+https://github.com/nerfstudio-project/nerfview@4538024fe0d15fd1a0e4d760f3695fc44ca72787"
# gsplat from source (pinned ref) — the slow step (~45 min per arch)
# Pins match image validated on 2026-09-11 (gsplat 1.6.0, 2026-09-03); bump GSPLAT_REF, WORLDMIRROR_REF, and torch versions together
ARG GSPLAT_REF=28e794ca44a4c25ffc39175370c5ee7b38bfcc36
RUN git clone --recursive --depth 1 --branch ${GSPLAT_REF} https://github.com/nerfstudio-project/gsplat.git tools/gsplat \
    && MAX_JOBS=8 CUDA_HOME=/usr/local/cuda uv pip install --python .venv/bin/python --no-build-isolation -e tools/gsplat
# pycolmap bridge (imported before torch: OpenSSL ordering) and the flash-attn SDPA shim
COPY tools/flash_attn_shim tools/flash_attn_shim
RUN SP=$(.venv/bin/python -c "import site;print(site.getsitepackages()[0])") && mkdir -p tools/pycolmap-bridge \
    && ln -s /opt/colmap/lib/python3.12/site-packages/pycolmap tools/pycolmap-bridge/pycolmap \
    && printf '%s\n%s\n' /opt/splatsite/tools/pycolmap-bridge 'import sys; exec("try:\n import pycolmap\nexcept Exception as e:\n sys.stderr.write(f\"pycolmap bridge: {e}\\n\")")' > "$SP/pycolmap-bridge.pth" \
    && echo /opt/splatsite/tools/flash_attn_shim > "$SP/flash-attn-shim.pth"
ARG WORLDMIRROR_REF=df9988efb87bfc0f4947eb3889411cf957478b06
RUN git clone --depth 1 --branch ${WORLDMIRROR_REF} https://github.com/Tencent-Hunyuan/HY-World-2.0 tools/worldmirror && touch tools/worldmirror/.installed
COPY pipeline pipeline
COPY splatsite/docker/reconstruct.py splatsite/docker/smoke_test.py ./
# the pose stage looks for COLMAP under tools/; point it at /opt/colmap and record the CUDA mode it checks
RUN mkdir -p tools/colmap/install/bin logs && ln -s /opt/colmap/bin/colmap tools/colmap/install/bin/colmap && echo cuda > logs/colmap-mode.txt \
    && .venv/bin/python smoke_test.py
VOLUME ["/input", "/work", "/weights"]
ENTRYPOINT ["/opt/splatsite/.venv/bin/python", "/opt/splatsite/reconstruct.py"]
