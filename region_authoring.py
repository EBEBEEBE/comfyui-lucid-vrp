"""Persisted authoring-state helpers for external VRP Region nodes."""

from __future__ import annotations

import json
import math

import numpy as np
from PIL import Image
import torch
import torch.nn.functional as F
import folder_paths
from .image_alignment import validate_view, transfer_mask


AUTHORING_VERSION = 1
DEFAULT_AUTHORING_STATE = json.dumps({
    "version": AUTHORING_VERSION,
    "bbox": None,
    "painted_mask": {"image_ref": ""},
}, separators=(",", ":"))
AUTHORING_MODES = ("BBox", "Painted Mask", "External MASK")


def parse_authoring_state(value):
    """Validate the versioned normalized geometry state used by BBox mode."""
    try:
        state = json.loads(value) if isinstance(value, str) else value
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError("Invalid VRP Region authoring state JSON") from exc
    if not isinstance(state, dict) or set(state) not in (
        {"version", "bbox"}, {"version", "bbox", "painted_mask"},
    ):
        raise ValueError("VRP Region authoring state must contain version, bbox and optional painted_mask")
    if type(state["version"]) is not int or state["version"] != AUTHORING_VERSION:
        raise ValueError("Unsupported VRP Region authoring-state version")
    bbox = state["bbox"]
    if bbox is not None and (not isinstance(bbox, dict) or set(bbox) != {"x", "y", "width", "height"}):
        raise ValueError("VRP Region bbox must contain x, y, width and height")
    for name, value in (bbox or {}).items():
        if type(value) not in (int, float) or not math.isfinite(value):
            raise ValueError(f"VRP Region bbox {name} must be finite")
    if bbox is not None and (bbox["x"] < 0 or bbox["y"] < 0 or bbox["width"] <= 0 or bbox["height"] <= 0 or
            bbox["x"] + bbox["width"] > 1 or bbox["y"] + bbox["height"] > 1):
        raise ValueError("VRP Region bbox must be a positive rectangle within normalized canvas bounds")
    painted_mask = state.get("painted_mask", {"image_ref": ""})
    if not isinstance(painted_mask, dict) or set(painted_mask) not in ({"image_ref"}, {"image_ref", "view"}):
        raise ValueError("VRP Region painted_mask state must contain image_ref")
    image_ref = painted_mask["image_ref"]
    if not isinstance(image_ref, str):
        raise ValueError("VRP Region painted mask image_ref must be a string")
    if 'view' in painted_mask:
        validate_view(painted_mask['view'])
    return {
        "version": AUTHORING_VERSION,
        "bbox": None if bbox is None else {key: float(value) for key, value in bbox.items()},
        "painted_mask": dict(painted_mask),
    }


def mask_image_to_canvas(image, width, height):
    """Decode Mask Editor alpha and scale it to the active canvas.

    ComfyUI Mask Editor saves the selected mask as inverse alpha. Browser and
    backend both fit the full raster to the current canvas dimensions. BILINEAR
    is used here to preserve soft brush edges; Anima downsampling remains the
    existing nearest-exact operation in ``mask_to_anima_spatial``.
    """
    if type(width) is not int or type(height) is not int or min(width, height) < 1:
        raise ValueError("Active canvas dimensions must be positive integers")
    rgba = image.convert("RGBA")
    alpha = np.asarray(rgba.getchannel("A"), dtype=np.uint8)
    selected = Image.fromarray(255 - alpha, mode="L")
    if selected.size != (width, height):
        selected = selected.resize((width, height), resample=Image.Resampling.BILINEAR)
    pixels = np.asarray(selected, dtype=np.float32) / 255.0
    return torch.from_numpy(pixels.copy()).unsqueeze(0)


def load_mask_image(image_ref, width, height, saved_view=None, active_view=None):
    """Load a file-backed Mask Editor image and return its active-canvas mask."""
    if not isinstance(image_ref, str) or not image_ref.strip():
        raise ValueError("Painted Mask mode requires a saved region mask image")
    path = folder_paths.get_annotated_filepath(image_ref)
    try:
        with Image.open(path) as image:
            image.load()
            if saved_view is not None and active_view is not None:
                mask = mask_image_to_canvas(image, *image.size)
                return transfer_mask(mask, saved_view, active_view), image.size
            return mask_image_to_canvas(image, width, height), image.size
    except (OSError, ValueError) as exc:
        raise ValueError(f"Could not load VRP Region mask image {image_ref!r}: {exc}") from exc


def resize_mask(mask, height, width):
    """Fit a validated [1,H,W] mask to an active canvas using bilinear sampling."""
    if not torch.is_tensor(mask) or mask.ndim != 3 or mask.shape[0] != 1:
        raise ValueError("VRP Region authored mask must have shape [1,H,W]")
    if min(mask.shape[-2:]) < 1 or min(height, width) < 1:
        raise ValueError("VRP Region authored mask dimensions must be positive")
    if tuple(mask.shape[-2:]) == (height, width):
        return mask.float().clamp(0, 1).contiguous()
    return F.interpolate(
        mask.float().unsqueeze(1), size=(height, width), mode="bilinear", align_corners=False,
    ).squeeze(1).clamp(0, 1).contiguous()
