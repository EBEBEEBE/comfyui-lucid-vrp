"""Minimal Anima regional attention support for the M1 backend proof.

The regional routing portions are adapted from:
https://github.com/Sen-sou/Comfyui-Anima-Regional-Conditioning

See THIRD_PARTY_NOTICES.md for the preserved MIT notice.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import partial
from typing import Optional

import torch
import torch.nn.functional as F

import comfy.patcher_extension
from comfy.ldm.modules import attention as comfy_attention
from .advanced_settings import DEFAULT_ADVANCED_SETTINGS, validate_advanced_settings


WRAPPER_KEY = "comfyui_anima_vrp_m1_regional"


@dataclass(frozen=True)
class RegionConditioning:
    mask: torch.Tensor
    conditioning: list
    weight: float = 1.0
    negative_conditioning: list | None = None


def _prepare_mask(mask: torch.Tensor) -> torch.Tensor:
    if not torch.is_tensor(mask):
        raise RuntimeError(f"Expected mask tensor, got {type(mask)}.")
    mask = mask.detach().float()
    if mask.ndim == 2:
        mask = mask.unsqueeze(0)
    elif mask.ndim == 3:
        mask = mask[:1]
    elif mask.ndim == 4:
        mask = mask[:1, 0]
    else:
        raise RuntimeError(f"Unsupported mask rank {mask.ndim}; expected H,W or B,H,W.")
    return mask.clamp(0.0, 1.0).cpu().contiguous()


def _conditioning_parts(conditioning: list, name: str) -> tuple[torch.Tensor, dict]:
    if not conditioning:
        raise RuntimeError(f"{name} is empty.")
    first = conditioning[0]
    if not isinstance(first, (list, tuple)) or not first:
        raise RuntimeError(f"{name} is not a valid ComfyUI CONDITIONING value.")
    cond = first[0]
    metadata = first[1] if len(first) > 1 and isinstance(first[1], dict) else {}
    if not torch.is_tensor(cond):
        raise RuntimeError(f"{name}[0][0] must be a tensor.")
    if cond.ndim == 4 and cond.shape[1] == 1:
        cond = cond.squeeze(1)
    if cond.ndim != 3:
        raise RuntimeError(f"{name} tensor must have shape [B,T,D] or [B,1,T,D].")
    return cond.detach(), metadata


def _batched_ids(ids: torch.Tensor, device: torch.device) -> torch.Tensor:
    ids = ids.to(device=device)
    if ids.ndim == 1:
        return ids.unsqueeze(0)
    if ids.ndim == 2:
        return ids
    raise RuntimeError(f"t5xxl_ids must have rank 1 or 2, got {ids.ndim}.")


def _batched_weights(weights: Optional[torch.Tensor], like: torch.Tensor) -> Optional[torch.Tensor]:
    if weights is None:
        return None
    weights = weights.to(device=like.device, dtype=like.dtype)
    if weights.ndim == 1:
        return weights.unsqueeze(0).unsqueeze(-1)
    if weights.ndim == 2:
        return weights.unsqueeze(-1)
    if weights.ndim == 3:
        return weights
    raise RuntimeError(f"t5xxl_weights must have rank 1, 2, or 3, got {weights.ndim}.")


def _prepare_conditioning(
    diffusion_model,
    conditioning: tuple[torch.Tensor, dict],
    device: torch.device,
    dtype: torch.dtype,
) -> torch.Tensor:
    cond, metadata = conditioning
    cond = cond.to(device=device, dtype=dtype)
    text_ids = metadata.get("t5xxl_ids")
    if text_ids is not None and hasattr(diffusion_model, "preprocess_text_embeds"):
        if not torch.is_tensor(text_ids):
            raise RuntimeError("t5xxl_ids must be a tensor.")
        weights = metadata.get("t5xxl_weights")
        if weights is not None and not torch.is_tensor(weights):
            raise RuntimeError("t5xxl_weights must be a tensor.")
        cond = diffusion_model.preprocess_text_embeds(
            cond,
            _batched_ids(text_ids, device),
            t5xxl_weights=_batched_weights(weights, cond),
        )
    return cond


def _normalize_context(context: torch.Tensor) -> torch.Tensor:
    if context.ndim == 4 and context.shape[1] == 1:
        return context.squeeze(1)
    if context.ndim == 3:
        return context
    raise RuntimeError(f"Unsupported context shape {tuple(context.shape)}.")


def _masks_to_token_masks(
    masks: list[torch.Tensor],
    latent_h: int,
    latent_w: int,
    patch_spatial: int,
    temporal_tokens: int,
) -> torch.Tensor:
    padded_h = math.ceil(latent_h / patch_spatial) * patch_spatial
    padded_w = math.ceil(latent_w / patch_spatial) * patch_spatial
    token_h = padded_h // patch_spatial
    token_w = padded_w // patch_spatial

    token_masks = []
    for mask in masks:
        resized = F.interpolate(
            mask.unsqueeze(1),
            size=(token_h, token_w),
            mode="nearest-exact",
        ).squeeze(1).squeeze(0)
        spatial = resized.reshape(token_h * token_w)
        token_masks.append(spatial.unsqueeze(0).expand(temporal_tokens, -1).reshape(-1) > 1e-6)
    return torch.stack(token_masks, dim=0)


def _slot_strengths_to_token_strengths(masks: torch.Tensor, strengths: torch.Tensor) -> torch.Tensor:
    result = torch.zeros(masks.shape[1], device=masks.device, dtype=strengths.dtype)
    for index in range(masks.shape[0]):
        result = torch.maximum(result, masks[index].to(strengths.dtype) * strengths[index])
    return result


def _cross_attention_bias(
    masks: torch.Tensor,
    text_lengths: list[int],
    base_mode: str,
    strengths: torch.Tensor,
    device: torch.device,
    dtype: torch.dtype,
    active_lengths: Optional[list[int]] = None,
) -> torch.Tensor:
    if active_lengths is None:
        active_lengths = text_lengths
    if len(active_lengths) != len(text_lengths) or any(
        active < 0 or active > available
        for active, available in zip(active_lengths, text_lengths)
    ):
        raise RuntimeError("Active conditioning lengths must fit within their context slots.")
    slots, query_tokens = masks.shape
    key_tokens = sum(text_lengths)
    allowed = torch.zeros((query_tokens, key_tokens), device=device, dtype=torch.bool)

    offsets = [0]
    for length in text_lengths[:-1]:
        offsets.append(offsets[-1] + length)

    for slot in range(slots):
        start = offsets[slot]
        end = start + active_lengths[slot]
        if slot == 0 and base_mode == "global":
            allowed[:, start:end] = True
        elif slot == 0 and base_mode == "disabled":
            continue
        else:
            positions = masks[slot].to(device=device).nonzero(as_tuple=True)[0]
            if positions.numel():
                allowed[positions, start:end] = True

    uncovered = ~allowed.any(dim=-1)
    if uncovered.any() and text_lengths[0]:
        allowed[uncovered, :text_lengths[0]] = True

    token_strengths = _slot_strengths_to_token_strengths(
        masks.to(device=device),
        strengths.to(device=device, dtype=dtype),
    )
    penalties = (-12.0 * token_strengths)[:, None].expand(-1, key_tokens)
    bias = torch.where(allowed, torch.zeros_like(penalties), penalties)
    for slot, (available, active) in enumerate(zip(text_lengths, active_lengths)):
        if active < available:
            start = offsets[slot] + active
            bias[:, start:start + available - active] = float("-inf")
    hard_rows = token_strengths >= 1.0
    if hard_rows.any():
        bias[hard_rows[:, None].expand(-1, key_tokens) & ~allowed] = float("-inf")
    return bias.unsqueeze(0).unsqueeze(0)


def _regional_negative_bias(
    masks: torch.Tensor,
    slot_lengths: list[int],
    negative_lengths: list[int],
    region_weights: torch.Tensor,
    cross_strength: float,
    device: torch.device,
    dtype: torch.dtype,
) -> torch.Tensor:
    """Route global negative text everywhere and each regional negative locally."""
    if len(slot_lengths) != masks.shape[0] or len(negative_lengths) != masks.shape[0]:
        raise RuntimeError("Regional negative slots do not match regional masks.")
    if any(length < 0 for length in slot_lengths) or any(
        negative < 0 or negative > available
        for negative, available in zip(negative_lengths, slot_lengths)
    ):
        raise RuntimeError("Regional negative conditioning lengths are invalid.")

    query_tokens = masks.shape[1]
    key_tokens = sum(slot_lengths)
    offsets = [0]
    for length in slot_lengths[:-1]:
        offsets.append(offsets[-1] + length)

    weights = region_weights.to(device=device, dtype=dtype).clamp(0.0, 1.0)
    bias = torch.full((query_tokens, key_tokens), float("-inf"), device=device, dtype=dtype)
    if slot_lengths[0]:
        bias[:, :slot_lengths[0]] = 0.0
    for slot in range(1, len(slot_lengths)):
        length = negative_lengths[slot]
        if not length:
            continue
        strength = float(max(0.0, min(1.0, float(weights[slot]) * cross_strength)))
        start = offsets[slot]
        value = -12.0 * (1.0 - strength)
        positions = masks[slot].to(device=device).nonzero(as_tuple=True)[0]
        if positions.numel():
            bias[positions, start:start + length] = value
    return bias.unsqueeze(0).unsqueeze(0)


def _self_attention_bias(
    masks: torch.Tensor,
    base_mode: str,
    strength: float,
    device: torch.device,
    dtype: torch.dtype,
) -> torch.Tensor:
    tokens = masks.shape[1]
    allowed = torch.zeros((tokens, tokens), device=device, dtype=torch.bool)
    if base_mode == "global":
        allowed[:] = True
    else:
        for index, mask in enumerate(masks):
            if index == 0 and base_mode == "disabled":
                continue
            region = mask.to(device=device)
            allowed |= region[:, None] & region[None, :]
        union = masks[1:].to(device=device).any(dim=0) if masks.shape[0] > 1 else torch.zeros(tokens, device=device, dtype=torch.bool)
        if base_mode != "disabled":
            union |= masks[0].to(device=device)
        background = ~union
        allowed |= background[:, None] & background[None, :]
        allowed |= torch.eye(tokens, device=device, dtype=torch.bool)

    bias = torch.zeros((tokens, tokens), device=device, dtype=dtype)
    if strength > 0.0 and base_mode != "global":
        bias.masked_fill_(~allowed, float("-inf"))
    return bias.unsqueeze(0).unsqueeze(0)


def _masked_attention(
    q: torch.Tensor,
    k: torch.Tensor,
    v: torch.Tensor,
    transformer_options: Optional[dict] = None,
    attn_bias: Optional[torch.Tensor] = None,
    *,
    preferred_attention=None,
) -> torch.Tensor:
    # Current ComfyUI passes a backend preference and single-owner containers.
    # Keep regional masking on the existing SDPA path; consume containers just
    # as the native Anima/Cosmos attention op does. Older tensor calls still work.
    container_type = getattr(comfy_attention, "AttentionTensorContainer", ())
    if isinstance(q, container_type):
        q, k, v = q.take(), k.take(), v.take()
    if q.ndim != 4 or k.ndim != 4 or v.ndim != 4:
        raise RuntimeError("Anima attention expected [B,S,H,D] Q/K/V tensors.")
    batch, query_length, heads, head_dim = q.shape
    q = q.permute(0, 2, 1, 3)
    k = k.permute(0, 2, 1, 3)
    v = v.permute(0, 2, 1, 3)
    bias = None if attn_bias is None else attn_bias.to(device=q.device, dtype=q.dtype)
    output = F.scaled_dot_product_attention(q, k, v, attn_mask=bias)
    return output.permute(0, 2, 1, 3).reshape(batch, query_length, heads * head_dim)


class AnimaM1Patch:
    def __init__(
        self,
        regions: list[RegionConditioning],
        base_mode: str = "global",
        cross_mask_strength: float = 1.0,
        self_mask_strength: float = 0.2,
        base_strength: float = 0.2,
        base_ratio: float = DEFAULT_ADVANCED_SETTINGS['base_ratio'],
        start_percent: float = 0.0,
        end_percent: float = 1.0,
        cross_inject_every: int = 1,
        self_inject_every: int = 1,
    ):
        if not regions:
            raise RuntimeError("At least one active regional conditioning is required.")
        settings = validate_advanced_settings({
            "version": 1,
            "base_mode": base_mode,
            "base_strength": base_strength,
            "start_percent": start_percent,
            "end_percent": end_percent,
            "cross_mask_strength": cross_mask_strength,
            "self_mask_strength": self_mask_strength,
            "base_ratio": base_ratio,
            "cross_inject_every": cross_inject_every,
            "self_inject_every": self_inject_every,
        })
        self.regions = regions
        self.base_mode = settings["base_mode"]
        self.cross_mask_strength = settings["cross_mask_strength"]
        self.self_mask_strength = settings["self_mask_strength"]
        self.base_strength = settings["base_strength"]
        self.base_ratio = settings["base_ratio"]
        self.start_percent = settings["start_percent"]
        self.end_percent = settings["end_percent"]
        self.cross_inject_every = settings["cross_inject_every"]
        self.self_inject_every = settings["self_inject_every"]
        self.start_sigma = None
        self.end_sigma = None

    def is_active(self, transformer_options: dict) -> bool:
        sigmas = transformer_options.get("sigmas")
        if self.start_sigma is None or self.end_sigma is None:
            return True
        if not torch.is_tensor(sigmas) or sigmas.numel() == 0:
            return True
        sigma = float(sigmas.max().detach().cpu().item())
        return min(self.start_sigma, self.end_sigma) <= sigma <= max(self.start_sigma, self.end_sigma)

    def prepare_regions(self, diffusion_model, device, dtype) -> list[torch.Tensor]:
        prepared = []
        for region in self.regions:
            cond, metadata = _conditioning_parts(region.conditioning, "regional conditioning")
            prepared.append(_prepare_conditioning(diffusion_model, (cond, metadata), device, dtype))
        return prepared

    def prepare_negative_regions(self, diffusion_model, device, dtype) -> list[Optional[torch.Tensor]]:
        prepared = []
        for region in self.regions:
            if region.negative_conditioning is None:
                prepared.append(None)
                continue
            cond, metadata = _conditioning_parts(
                region.negative_conditioning,
                "regional negative conditioning",
            )
            prepared.append(_prepare_conditioning(
                diffusion_model,
                (cond, metadata),
                device,
                dtype,
            ))
        return prepared


def _validate_anima_model(model):
    base_model = getattr(model, "model", None)
    if base_model is None:
        raise RuntimeError("Invalid MODEL input: missing internal model.")
    config = getattr(base_model, "model_config", None)
    if config is not None:
        image_model = config.unet_config.get("image_model")
        if image_model != "anima":
            raise RuntimeError("Anima VRP M1 supports Anima models only.")
    diffusion_model = getattr(base_model, "diffusion_model", None)
    if diffusion_model is None or not hasattr(diffusion_model, "blocks"):
        raise RuntimeError("MODEL does not expose an Anima diffusion model.")
    if not hasattr(diffusion_model, "patch_spatial"):
        raise RuntimeError("Anima diffusion model is missing patch_spatial.")
    return diffusion_model


def _diffusion_model_wrapper(executor, *args, **kwargs):
    transformer_options = kwargs.get("transformer_options")
    if not isinstance(transformer_options, dict):
        return executor(*args, **kwargs)

    patch = transformer_options.get(WRAPPER_KEY)
    if patch is None:
        return executor(*args, **kwargs)
    if not patch.is_active(transformer_options):
        return executor(*args, **kwargs)

    input_x = args[0] if args else kwargs.get("x")
    raw_context = args[2] if len(args) > 2 else kwargs.get("context")
    if not torch.is_tensor(input_x) or input_x.ndim < 5:
        raise RuntimeError("Anima VRP expected diffusion input shaped [B,C,T,H,W].")
    expected = getattr(patch, 'expected_latent_shape', None)
    if expected is not None and (input_x.shape[-3] != 1 or tuple(input_x.shape[-2:]) != expected):
        raise RuntimeError('VRP canvas dimensions do not match the sampler latent')
    if not torch.is_tensor(raw_context):
        raise RuntimeError("Anima VRP expected tensor cross-attention context.")

    context = _normalize_context(raw_context)
    cond_or_uncond = transformer_options.get("cond_or_uncond", [])
    if not cond_or_uncond:
        return executor(*args, **kwargs)
    if context.shape[0] % len(cond_or_uncond):
        raise RuntimeError("Anima VRP context batch is incompatible with CFG chunks.")

    diffusion_model = executor.class_obj
    batch_size = context.shape[0] // len(cond_or_uncond)
    device, dtype = context.device, context.dtype
    region_conditionings = patch.prepare_regions(diffusion_model, device, dtype)
    region_lengths = [cond.shape[1] for cond in region_conditionings]
    region_batch = []
    for cond in region_conditionings:
        if cond.shape[0] == 1:
            region_batch.append(cond.expand(batch_size, -1, -1))
        elif cond.shape[0] == batch_size:
            region_batch.append(cond)
        else:
            raise RuntimeError("Regional conditioning batch does not match sampler batch.")

    base_length = context.shape[1]
    positive_lengths = region_lengths
    has_regional_negative = any(region.negative_conditioning is not None for region in patch.regions)
    if not has_regional_negative:
        # Keep the accepted M4 path byte-for-byte in its context layout and bias
        # construction when no regional negative prompt is supplied.
        total_length = base_length + sum(region_lengths)
        context_chunks = context.chunk(len(cond_or_uncond), dim=0)
        unified_chunks = []
        for chunk, kind in zip(context_chunks, cond_or_uncond):
            if kind == 1:
                padding = torch.zeros(
                    batch_size,
                    total_length - base_length,
                    context.shape[2],
                    device=device,
                    dtype=dtype,
                )
                unified_chunks.append(torch.cat((chunk, padding), dim=1))
            else:
                unified_chunks.append(torch.cat((chunk, *region_batch), dim=1))
        unified_context = torch.cat(unified_chunks, dim=0)
        slot_lengths = region_lengths
        negative_lengths = [0] * len(region_lengths)
        negative_conditionings = None
    else:
        negative_conditionings = patch.prepare_negative_regions(diffusion_model, device, dtype)
        negative_lengths = [0 if cond is None else cond.shape[1] for cond in negative_conditionings]
        slot_lengths = [max(positive, negative) for positive, negative in zip(region_lengths, negative_lengths)]
        padded_positive = []
        for cond, length in zip(region_batch, slot_lengths):
            if cond.shape[1] < length:
                cond = F.pad(cond, (0, 0, 0, length - cond.shape[1]))
            padded_positive.append(cond)
        padded_negative = []
        for cond, length in zip(negative_conditionings, slot_lengths):
            if cond is None:
                padded_negative.append(torch.zeros(
                    batch_size, length, context.shape[2], device=device, dtype=dtype,
                ))
            else:
                if cond.shape[0] == 1:
                    cond = cond.expand(batch_size, -1, -1)
                elif cond.shape[0] != batch_size:
                    raise RuntimeError("Regional negative conditioning batch does not match sampler batch.")
                if cond.shape[1] < length:
                    cond = F.pad(cond, (0, 0, 0, length - cond.shape[1]))
                padded_negative.append(cond)

        total_length = base_length + sum(slot_lengths)
        context_chunks = context.chunk(len(cond_or_uncond), dim=0)
        unified_chunks = []
        for chunk, kind in zip(context_chunks, cond_or_uncond):
            regional = padded_negative if kind == 1 else padded_positive
            unified_chunks.append(torch.cat((chunk, *regional), dim=1))
        unified_context = torch.cat(unified_chunks, dim=0)

    latent_t = int(input_x.shape[-3])
    latent_h = int(input_x.shape[-2])
    latent_w = int(input_x.shape[-1])
    patch_spatial = int(diffusion_model.patch_spatial)
    patch_temporal = int(getattr(diffusion_model, "patch_temporal", 1))
    temporal_tokens = math.ceil(latent_t / patch_temporal)
    region_masks = [_prepare_mask(region.mask) for region in patch.regions]
    region_token_masks = _masks_to_token_masks(
        region_masks,
        int(latent_h),
        int(latent_w),
        patch_spatial,
        temporal_tokens,
    )
    if patch.base_mode == "global":
        base_token_mask = torch.ones_like(region_token_masks[0])
    elif patch.base_mode == "disabled":
        base_token_mask = torch.zeros_like(region_token_masks[0])
    else:
        base_token_mask = ~region_token_masks.any(dim=0)
    token_masks = torch.cat((base_token_mask.unsqueeze(0), region_token_masks), dim=0)
    strengths = torch.tensor(
        [patch.base_strength] + [region.weight for region in patch.regions],
        device=device,
        dtype=dtype,
    ).clamp(0.0, 1.0)
    if not has_regional_negative:
        cross_bias = _cross_attention_bias(
            token_masks,
            [base_length] + region_lengths,
            patch.base_mode,
            strengths * patch.cross_mask_strength,
            device,
            dtype,
        )
        uncond_bias = torch.full_like(cross_bias, float("-inf"))
        uncond_bias[:, :, :, :base_length] = 0.0
    else:
        cross_bias = _cross_attention_bias(
            token_masks,
            [base_length] + slot_lengths,
            patch.base_mode,
            strengths * patch.cross_mask_strength,
            device,
            dtype,
            active_lengths=[base_length] + positive_lengths,
        )
        uncond_bias = _regional_negative_bias(
            token_masks,
            [base_length] + slot_lengths,
            [0] + negative_lengths,
            strengths,
            patch.cross_mask_strength,
            device,
            dtype,
        )
    base_only_bias = torch.full_like(cross_bias, float("-inf"))
    base_only_bias[:, :, :, :base_length] = 0.0
    full_cross_bias = torch.cat(
        [
            (uncond_bias if kind == 1 else cross_bias).expand(batch_size, -1, -1, -1)
            for kind in cond_or_uncond
        ],
        dim=0,
    )

    full_self_bias = None
    # Global mode has no self-region restriction. Keep the existing SDPA
    # implementation below, with no mask, rather than allocating N x N zeros.
    if patch.self_mask_strength > 0.0 and patch.base_mode != "global":
        self_bias = _self_attention_bias(
            token_masks,
            patch.base_mode,
            patch.self_mask_strength,
            device,
            dtype,
        )
        full_self_bias = torch.cat(
            [
                (torch.zeros_like(self_bias) if kind == 1 else self_bias).expand(batch_size, -1, -1, -1)
                for kind in cond_or_uncond
            ],
            dim=0,
        )

    base_output = executor(*args, **kwargs) if patch.base_ratio > 0.0 else None
    original_ops = []
    try:
        for block_index, block in enumerate(diffusion_model.blocks):
            cross_attn = getattr(block, "cross_attn", None)
            # Zero disables positive spatial penalties, but CFG slot/padding
            # isolation and local regional negatives still require a bias.
            if cross_attn is not None:
                original_ops.append((cross_attn, cross_attn.attn_op))
                cross_bias_for_block = (
                    full_cross_bias
                    if patch.cross_mask_strength == 0.0 or block_index % patch.cross_inject_every == 0
                    else base_only_bias.expand(full_cross_bias.shape[0], -1, -1, -1)
                )
                cross_attn.attn_op = partial(_masked_attention, attn_bias=cross_bias_for_block)
            self_attn = getattr(block, "self_attn", None)
            if (
                self_attn is not None
                and patch.self_mask_strength > 0.0
                and block_index % patch.self_inject_every == 0
            ):
                original_ops.append((self_attn, self_attn.attn_op))
                self_attn.attn_op = partial(_masked_attention, attn_bias=full_self_bias)

        call_args = list(args)
        call_kwargs = dict(kwargs)
        if len(call_args) > 2:
            call_args[2] = unified_context
        else:
            call_kwargs["context"] = unified_context
        regional_output = executor(*tuple(call_args), **call_kwargs)
        if base_output is not None:
            regional_output = regional_output * (1.0 - patch.base_ratio) + base_output * patch.base_ratio
        return regional_output
    finally:
        for attention, original_op in original_ops:
            attention.attn_op = original_op


def install_m1_patch(
    model,
    regions: list[RegionConditioning],
    expected_latent_shape=None,
    advanced_settings=None,
):
    _validate_anima_model(model)
    settings = validate_advanced_settings(
        advanced_settings if advanced_settings is not None else DEFAULT_ADVANCED_SETTINGS
    )
    patched_model = model.clone()
    patched_model.remove_wrappers_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        WRAPPER_KEY,
    )
    if not regions:
        patched_model.model_options.setdefault('transformer_options', {}).pop(WRAPPER_KEY, None)
        return patched_model
    patch = AnimaM1Patch(
        regions,
        base_mode=settings["base_mode"],
        base_strength=settings["base_strength"],
        start_percent=settings["start_percent"],
        end_percent=settings["end_percent"],
        cross_mask_strength=settings["cross_mask_strength"],
        self_mask_strength=settings["self_mask_strength"],
        base_ratio=settings["base_ratio"],
        cross_inject_every=settings["cross_inject_every"],
        self_inject_every=settings["self_inject_every"],
    )
    if hasattr(model, "get_model_object"):
        model_sampling = model.get_model_object("model_sampling")
        if model_sampling is not None and hasattr(model_sampling, "percent_to_sigma"):
            patch.start_sigma = float(model_sampling.percent_to_sigma(patch.start_percent))
            patch.end_sigma = float(model_sampling.percent_to_sigma(patch.end_percent))
    patch.expected_latent_shape = expected_latent_shape
    patched_model.add_wrapper_with_key(
        comfy.patcher_extension.WrappersMP.DIFFUSION_MODEL,
        WRAPPER_KEY,
        _diffusion_model_wrapper,
    )
    patched_model.model_options.setdefault("transformer_options", {})[WRAPPER_KEY] = patch
    patched_model.set_attachments(WRAPPER_KEY, patch)
    return patched_model
