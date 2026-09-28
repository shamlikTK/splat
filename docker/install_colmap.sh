#!/usr/bin/env bash
# splatsite/docker/install_colmap.sh — COLMAP 4.2 + pycolmap (CUDA 13 builds) from conda-forge into /opt/colmap
set -euo pipefail
case "$(uname -m)" in x86_64) MM=linux-64;; aarch64) MM=linux-aarch64;; *) echo "unsupported arch"; exit 1;; esac
curl -Ls "https://micro.mamba.pm/api/micromamba/$MM/latest" | tar -xj -C /tmp bin/micromamba
export MAMBA_ROOT_PREFIX=/opt/micromamba
# the builder has no GPU, so micromamba can't detect the __cuda virtual package on its own;
# force it so the cuda_130-variant colmap/pycolmap builds are still solvable/installable here.
export CONDA_OVERRIDE_CUDA=13.0
/tmp/bin/micromamba create -y -q -p /opt/colmap -c conda-forge python=3.12 "colmap=4.2.0=cuda_130*" "pycolmap=4.2.0=cuda_130*" "openimageio=3.1.*"
/tmp/bin/micromamba clean -a -y; rm -rf /opt/micromamba/pkgs
