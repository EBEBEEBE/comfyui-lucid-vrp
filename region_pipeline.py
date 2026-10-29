"""Versioned canonical region and regional-prompt runtime contracts.

This module is deliberately independent of the Anima attention implementation.
All region sources resolve to a validated Anima-spatial MASK before they are
converted into ``RegionConditioning`` objects by the node layer.
"""

from __future__ import annotations

from copy import deepcopy
import math

import torch
import torch.nn.functional as F


REGION_TYPE = "VRP_REGION"
REGIONS_TYPE = "VRP_REGIONS"
PROMPTS_TYPE = "VRP_PROMPTS"
CONTRACT_VERSION = 1
SPATIAL_DOWNSCALE = 8

_REGION_FIELDS = {
    "version", "region_id", "label", "mask", "positive_prompt",
    "negative_prompt", "weight", "canvas", "source", "extensions",
}
_CANVAS_FIELDS = {"version", "width", "height", "revision"}
_PROMPT_FIELDS = {"region_id", "positive", "negative"}


def _finite_number(value, path):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{path} must be a finite number")
    return float(value)


def canvas_metadata(canvas):
    """Return the minimal immutable canvas identity carried by a region."""
    if not isinstance(canvas, dict):
        raise ValueError("VRP region canvas metadata must be an object")
    full_fields = {"version", "width", "height", "revision", "source", "image_ref"}
    if set(canvas) in (full_fields, full_fields | {'alignment'}):
        if 'alignment' in canvas:
            from .canvas import validate_descriptor
            validate_descriptor(canvas)
        source = canvas["source"]
        if source not in ("blank", "image"):
            raise ValueError("Invalid VRP canvas source")
    elif not (_CANVAS_FIELDS <= set(canvas) <= _CANVAS_FIELDS | {"source_id", "image_ref"}):
        raise ValueError("VRP region canvas metadata has invalid fields")
    if type(canvas.get("version")) is not int or canvas["version"] != CONTRACT_VERSION:
        raise ValueError("Unsupported VRP region canvas metadata version")
    for name in ("width", "height"):
        value = canvas.get(name)
        if type(value) is not int or value < 8 or value % SPATIAL_DOWNSCALE:
            raise ValueError(f"VRP region canvas {name} must be a positive multiple of 8")
    revision = canvas.get("revision")
    if type(revision) is not int or revision < 0:
        raise ValueError("VRP region canvas revision must be a nonnegative integer")
    metadata = {
        "version": CONTRACT_VERSION,
        "width": canvas["width"],
        "height": canvas["height"],
        "revision": revision,
    }
    source_id = canvas.get('alignment', {}).get('source_id', canvas.get('source_id'))
    if source_id is not None or 'source_id' in canvas:
        if not isinstance(source_id, str) or not source_id:
            raise ValueError('Invalid VRP canvas document identity')
        metadata['source_id'] = source_id
    if 'image_ref' in canvas:
        reference = canvas['image_ref']
        if reference is not None and not isinstance(reference, str):
            raise ValueError('Invalid VRP canvas image reference')
        metadata['image_ref'] = reference
    return metadata


def _normalize_mask(mask):
    if not torch.is_tensor(mask):
        raise ValueError(f"VRP region mask must be a torch.Tensor, got {type(mask)}")
    if mask.ndim == 2:
        normalized = mask.unsqueeze(0)
    elif mask.ndim == 3:
        if mask.shape[0] != 1:
            raise ValueError("VRP region mask must contain exactly one batch")
        normalized = mask
    elif mask.ndim == 4:
        if mask.shape[0] != 1 or mask.shape[1] != 1:
            raise ValueError("VRP region mask must have shape [1,H,W] or [1,1,H,W]")
        normalized = mask[:, 0]
    else:
        raise ValueError("VRP region mask must have shape [H,W], [1,H,W] or [1,1,H,W]")
    if normalized.shape[-2] < 1 or normalized.shape[-1] < 1:
        raise ValueError("VRP region mask dimensions must be positive")
    normalized = normalized.detach().float().cpu().contiguous()
    if not torch.isfinite(normalized).all():
        raise ValueError("VRP region mask must contain finite values")
    return normalized.clamp(0.0, 1.0)


def mask_to_anima_spatial(mask, canvas, downscale=SPATIAL_DOWNSCALE):
    """Resolve a normal canvas MASK to the Anima latent spatial resolution.

    A mask may already be at the expected Anima resolution, which is useful
    for procedural/test producers. A full-canvas mask is downsampled with the
    same nearest-exact convention used by the routing token conversion. Any
    other dimensions are rejected instead of being silently resized.
    """
    metadata = canvas_metadata(canvas)
    if type(downscale) is not int or downscale < 1:
        raise ValueError("Mask downscale must be a positive integer")
    normalized = _normalize_mask(mask)
    full_shape = (metadata["height"], metadata["width"])
    anima_shape = (metadata["height"] // downscale, metadata["width"] // downscale)
    actual = tuple(int(value) for value in normalized.shape[-2:])
    if actual == anima_shape:
        return normalized
    if actual != full_shape:
        raise ValueError(
            "External MASK dimensions do not match its VRP_CANVAS: "
            f"expected {full_shape} or Anima spatial {anima_shape}, got {actual}"
        )
    return F.interpolate(
        normalized.unsqueeze(1), size=anima_shape, mode="nearest-exact"
    ).squeeze(1).contiguous()


def make_region(
    region_id,
    label,
    mask,
    positive_prompt,
    negative_prompt,
    weight,
    canvas,
    source,
    extensions=None,
):
    """Construct and validate one canonical ``VRP_REGION`` value."""
    region = {
        "version": CONTRACT_VERSION,
        "region_id": region_id,
        "label": label,
        "mask": mask,
        "positive_prompt": positive_prompt,
        "negative_prompt": negative_prompt,
        "weight": weight,
        "canvas": canvas,
        "source": source,
        "extensions": {} if extensions is None else extensions,
    }
    return validate_region(region)


def validate_region(region, expected_mask_shape=None):
    if not isinstance(region, dict) or set(region) != _REGION_FIELDS:
        raise ValueError(
            "VRP_REGION must contain version, region_id, label, mask, "
            "positive_prompt, negative_prompt, weight, canvas, source and extensions"
        )
    if type(region["version"]) is not int or region["version"] != CONTRACT_VERSION:
        raise ValueError("Unsupported VRP_REGION version")
    if not isinstance(region["region_id"], str) or not region["region_id"].strip():
        raise ValueError("VRP_REGION region_id must be a nonempty string")
    for name in ("label", "positive_prompt", "negative_prompt"):
        if not isinstance(region[name], str):
            raise ValueError(f"VRP_REGION {name} must be a string")
    weight = _finite_number(region["weight"], "VRP_REGION weight")
    if not 0.0 <= weight <= 1.0:
        raise ValueError("VRP_REGION weight must be between 0 and 1")
    region["weight"] = weight
    region["canvas"] = canvas_metadata(region["canvas"])
    if not isinstance(region["source"], dict) or not isinstance(region["source"].get("type"), str):
        raise ValueError("VRP_REGION source metadata must contain a type")
    if not isinstance(region["extensions"], dict):
        raise ValueError("VRP_REGION extensions must be an object")
    region["mask"] = _normalize_mask(region["mask"])
    if expected_mask_shape is not None and tuple(region["mask"].shape[-2:]) != tuple(expected_mask_shape):
        raise ValueError(
            f"VRP_REGION {region['region_id']!r} mask does not match expected Anima spatial "
            f"shape {tuple(expected_mask_shape)}"
        )
    return region


def validate_regions(value, expected_mask_shape=None):
    """Validate a versioned ``VRP_REGIONS`` bundle and preserve its order."""
    if not isinstance(value, dict) or set(value) != {"version", "regions"}:
        raise ValueError("VRP_REGIONS must contain exactly version and regions")
    if type(value["version"]) is not int or value["version"] != CONTRACT_VERSION:
        raise ValueError("Unsupported VRP_REGIONS version")
    if not isinstance(value["regions"], list):
        raise ValueError("VRP_REGIONS regions must be an array")
    ids = set()
    regions = []
    for index, region in enumerate(value["regions"]):
        normalized = validate_region(region, expected_mask_shape)
        if normalized["region_id"] in ids:
            raise ValueError(f"Duplicate VRP region_id {normalized['region_id']!r}")
        ids.add(normalized["region_id"])
        regions.append(normalized)
    value["regions"] = regions
    return value


def make_regions(regions):
    return validate_regions({"version": CONTRACT_VERSION, "regions": list(regions)})


def unique_region_labels(regions):
    """Return regions with deterministic, case-insensitively unique labels.

    IDs and ordering are never changed. The helper is applied when independent
    region sources become one effective roster, because separately authored
    chains cannot know about one another's labels.
    """
    result = []
    used = set()
    for index, region in enumerate(regions, start=1):
        label = region["label"].strip() or f"Region {index}"
        candidate = label
        suffix = 2
        while candidate.casefold() in used:
            candidate = f"{label} ({suffix})"
            suffix += 1
        used.add(candidate.casefold())
        if candidate == region["label"]:
            result.append(region)
        else:
            normalized = dict(region)
            normalized["label"] = candidate
            result.append(normalized)
    return result


def append_region(previous, region, expected_mask_shape=None):
    """Append one validated region to a chain without changing prior order."""
    bundle = {"version": CONTRACT_VERSION, "regions": []} if previous is None else previous
    bundle = validate_regions(bundle, expected_mask_shape)
    region = validate_region(region, expected_mask_shape)
    if any(item["region_id"] == region["region_id"] for item in bundle["regions"]):
        raise ValueError(f"Duplicate VRP region_id {region['region_id']!r} in chain")
    regions = unique_region_labels([*bundle["regions"], region])
    return {"version": CONTRACT_VERSION, "regions": regions}


def validate_prompts(value):
    """Validate the stable-ID-aware ``VRP_PROMPTS`` bundle."""
    if not isinstance(value, dict) or set(value) != {"version", "prompts"}:
        raise ValueError("VRP_PROMPTS must contain exactly version and prompts")
    if type(value["version"]) is not int or value["version"] != CONTRACT_VERSION:
        raise ValueError("Unsupported VRP_PROMPTS version")
    if not isinstance(value["prompts"], list):
        raise ValueError("VRP_PROMPTS prompts must be an array")
    ids = set()
    for index, prompt in enumerate(value["prompts"]):
        if not isinstance(prompt, dict) or set(prompt) != _PROMPT_FIELDS:
            raise ValueError(
                f"VRP_PROMPTS prompts[{index}] must contain region_id, positive and negative"
            )
        identity = prompt["region_id"]
        if not isinstance(identity, str) or not identity.strip() or identity in ids:
            raise ValueError(f"VRP_PROMPTS prompts[{index}].region_id must be unique")
        if not isinstance(prompt["positive"], str) or not isinstance(prompt["negative"], str):
            raise ValueError(f"VRP_PROMPTS prompts[{index}] values must be strings")
        ids.add(identity)
    return value


def apply_prompt_overrides(regions, prompts):
    """Apply regional prompt overrides by stable ID, never by list position."""
    if prompts is None:
        return list(regions)
    prompts = validate_prompts(prompts)
    by_id = {item["region_id"]: item for item in prompts["prompts"]}
    region_ids = {item["region_id"] for item in regions}
    unknown = sorted(set(by_id) - region_ids)
    if unknown:
        raise ValueError(f"VRP_PROMPTS references unknown region_id(s): {', '.join(unknown)}")
    result = []
    for region in regions:
        override = by_id.get(region["region_id"])
        if override is None:
            result.append(region)
            continue
        updated = dict(region)
        updated["positive_prompt"] = override["positive"]
        updated["negative_prompt"] = override["negative"]
        result.append(updated)
    return result


def check_canvas_compatibility(regions, canvas, expected_mask_shape=None):
    """Reject external regions authored against another canvas/revision."""
    current = canvas_metadata(canvas)
    for region in regions:
        region_canvas = region["canvas"]
        if (region_canvas["width"], region_canvas["height"]) != (current["width"], current["height"]):
            raise ValueError(
                f"VRP region {region['region_id']!r} canvas dimensions "
                f"{region_canvas['width']}x{region_canvas['height']} do not match "
                f"current canvas {current['width']}x{current['height']}"
            )
        if region_canvas["revision"] != current["revision"]:
            raise ValueError(
                f"VRP region {region['region_id']!r} is stale: revision "
                f"{region_canvas['revision']} does not match current canvas revision "
                f"{current['revision']}"
            )
        # Document loaders retain the same ID through edits, history and canvas
        # relays. Legacy descriptors have no ID; their file reference is the
        # best available identity. Never match an identified document to an
        # unidentified or independently identified bundle by geometry alone.
        if (region_canvas.get('source_id') != current.get('source_id') or
                region_canvas.get('image_ref') != current.get('image_ref')):
            raise ValueError(f"VRP region {region['region_id']!r} belongs to another canvas document")
        if expected_mask_shape is not None and tuple(region["mask"].shape[-2:]) != tuple(expected_mask_shape):
            raise ValueError(
                f"VRP region {region['region_id']!r} mask does not match current Anima latent shape"
            )


def merge_regions(internal, external=None, prompts=None):
    """Append external regions to internal regions and apply ID-based prompts."""
    internal = list(internal)
    external_regions = [] if external is None else validate_regions(external)["regions"]
    ids = set()
    merged = []
    for region in [*internal, *external_regions]:
        region = validate_region(region)
        identity = region["region_id"]
        if identity in ids:
            raise ValueError(f"Duplicate effective VRP region_id {identity!r}")
        ids.add(identity)
        merged.append(region)
    return unique_region_labels(apply_prompt_overrides(merged, prompts))


def clone_contract(value):
    """Copy metadata while retaining tensor identity/content without JSON tricks."""
    if isinstance(value, dict):
        return {key: clone_contract(item) for key, item in value.items()}
    if isinstance(value, list):
        return [clone_contract(item) for item in value]
    if torch.is_tensor(value):
        return value.clone()
    return deepcopy(value)
