"""Muse Spark Open on Modal: an OpenAI-compatible endpoint (vLLM) for Nearer.

Deploy (uses Modal credits; scales to zero when idle):
    pip install modal && modal setup
    modal secret create aangan-muse MODAL_API_KEY=<long random string> HF_TOKEN=<hf token>
    MUSE_WEIGHTS=<Hugging Face repo id of the open weights> modal deploy modal/muse_server.py

Then set in Vercel:
    MODAL_MUSE_URL=https://<workspace>--aangan-muse-serve.modal.run/v1
    MODAL_API_KEY=<same string>
    MODAL_MUSE_MODEL=meta-models/muse-spark-open-1026   # the name vLLM serves
    MUSE_PROVIDER=modal   # optional: make it primary; otherwise it is the last failover
"""

import os
import subprocess

import modal

WEIGHTS = os.environ.get("MUSE_WEIGHTS", "")
SERVED_NAME = "meta-models/muse-spark-open-1026"
GPU = os.environ.get("MUSE_GPU", "H100")

image = modal.Image.debian_slim(python_version="3.12").pip_install("vllm==0.11.0", "huggingface_hub[hf_transfer]").env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "MUSE_WEIGHTS": WEIGHTS})  # baked in at deploy time
weights = modal.Volume.from_name("aangan-muse-weights", create_if_missing=True)
app = modal.App("aangan-muse")


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/root/.cache/huggingface": weights},
    secrets=[modal.Secret.from_name("aangan-muse")],
    scaledown_window=300,  # 5 idle minutes, then zero GPUs and zero cost
    timeout=60 * 20,
)
@modal.concurrent(max_inputs=32)
@modal.web_server(port=8000, startup_timeout=60 * 15)
def serve() -> None:
    if not WEIGHTS:
        raise RuntimeError("Set MUSE_WEIGHTS to the open-weights repo id when deploying.")
    subprocess.Popen(
        [
            "vllm", "serve", WEIGHTS,
            "--served-model-name", SERVED_NAME,
            "--host", "0.0.0.0", "--port", "8000",
            "--api-key", os.environ["MODAL_API_KEY"],
            "--max-model-len", "32768",
        ]
    )
