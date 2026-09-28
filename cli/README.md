# splatsite

Video walkthrough → Gaussian-splat capture (in Docker) → interactive photo-walk website.

```
splatsite convert <video> --quality fast --out ./scene --image splatsite-recon:dev
splatsite build ./scene --photos ./pics --out ./site
splatsite check ./site
splatsite serve ./site
```

For install steps, requirements, every command's options, quality levels and CPU-host
behaviour, license notes, and troubleshooting, see the main
[README](../README.md). For the `manifest.json` format — every key, the `{t, a, h}`
coordinate system, poses, spots, theme — see [`../docs/manifest.md`](../docs/manifest.md).
