"""Meta SAM on Modal: one point in, one cut-out mask out, for Nearer stickers.

The app's /api/stickers/cutout forwards a photo the person chose (their own)
and the point they tapped. This returns a PNG mask the same size as the photo:
white where the person or dish is, black elsewhere. Nothing is stored or
logged; the GPU scales to zero when idle.

Model: SAM 2.1 by default (facebook/sam2.1-hiera-large, open weights). Set
SAM_MODEL=facebook/sam3 to use SAM 3 (gated on Hugging Face: accept the licence
with the account whose HF_TOKEN you give Modal). Both load through
`transformers` and take the same point prompt.

Deploy (uses Modal credits):
    pip install modal && modal setup
    modal secret create aangan-sam SAM_API_KEY=<long random string> HF_TOKEN=<hf token>
    modal deploy modal/sam_server.py                      # SAM 2.1
    SAM_MODEL=facebook/sam3 modal deploy modal/sam_server.py   # or SAM 3

Then set on the Worker (see docs/DEPLOY.md):
    SAM_URL=https://<workspace>--aangan-sam-cutout.modal.run
    SAM_API_KEY=<same string>

Request:  POST {"image": "<base64 jpeg/png>", "point": [x, y], "normalized": true}
          with "Authorization: Bearer <SAM_API_KEY>"; x, y in 0..1 when normalized.
Response: image/png mask (L mode, 0 or 255), or 4xx JSON on a bad request.
"""

import os

import modal

SAM_MODEL = os.environ.get("SAM_MODEL", "facebook/sam2.1-hiera-large")
GPU = os.environ.get("SAM_GPU", "L4")

image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("torch==2.8.0", "transformers==4.57.1", "accelerate", "pillow", "fastapi[standard]", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "SAM_MODEL": SAM_MODEL})  # baked in at deploy time
)
weights = modal.Volume.from_name("aangan-sam-weights", create_if_missing=True)
app = modal.App("aangan-sam")

with image.imports():
    # Only inside the container; `modal deploy` itself needs just `modal`.
    from fastapi import Header
    from fastapi.responses import JSONResponse, Response

MAX_BYTES = 2_000_000


@app.cls(
    image=image,
    gpu=GPU,
    volumes={"/root/.cache/huggingface": weights},
    secrets=[modal.Secret.from_name("aangan-sam")],
    scaledown_window=120,  # two idle minutes, then zero GPUs
    timeout=120,
)
@modal.concurrent(max_inputs=4)
class Sam:
    @modal.enter()
    def load(self) -> None:
        import torch

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        token = os.environ.get("HF_TOKEN") or None
        if "sam3" in SAM_MODEL:
            from transformers import Sam3TrackerModel as Model, Sam3TrackerProcessor as Processor
        else:
            from transformers import Sam2Model as Model, Sam2Processor as Processor
        self.processor = Processor.from_pretrained(SAM_MODEL, token=token)
        self.model = Model.from_pretrained(SAM_MODEL, token=token, torch_dtype=torch.float32).to(self.device).eval()

    def mask_png(self, data: bytes, x: float, y: float) -> bytes:
        import io

        import numpy as np
        from PIL import Image, ImageOps

        img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
        w, h = img.size
        px, py = min(max(x, 0.0), 1.0) * (w - 1), min(max(y, 0.0), 1.0) * (h - 1)
        # One image, one object, one positive point.
        inputs = self.processor(images=img, input_points=[[[[px, py]]]], input_labels=[[[1]]], return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.model(**inputs, multimask_output=True)
        masks = self.processor.post_process_masks(out.pred_masks.cpu(), inputs["original_sizes"])[0]  # (objects, 3, H, W)
        scores = out.iou_scores.cpu()[0, 0]  # (3,)
        best = masks[0, int(scores.argmax())].numpy().astype(bool)
        m = Image.fromarray((best * 255).astype(np.uint8), mode="L")
        buf = io.BytesIO()
        m.save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    @modal.fastapi_endpoint(method="POST", label="aangan-sam-cutout")
    def cutout(self, body: dict, authorization: str = Header(default="")):
        import base64
        import hmac

        expected = f"Bearer {os.environ.get('SAM_API_KEY', '')}"
        if not os.environ.get("SAM_API_KEY") or not hmac.compare_digest(authorization or "", expected):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        try:
            data = base64.b64decode(body.get("image", ""), validate=True)
            x, y = (float(v) for v in body.get("point", [0.5, 0.5]))
        except Exception:
            return JSONResponse({"error": "bad-request"}, status_code=400)
        if not data or len(data) > MAX_BYTES:
            return JSONResponse({"error": "bad-image"}, status_code=400)
        if not body.get("normalized", True):
            return JSONResponse({"error": "points must be normalized (0..1)"}, status_code=400)
        try:
            png = self.mask_png(data, x, y)
        except Exception:
            return JSONResponse({"error": "sam-failed"}, status_code=500)
        return Response(content=png, media_type="image/png", headers={"cache-control": "no-store"})
