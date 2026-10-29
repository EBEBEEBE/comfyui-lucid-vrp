"""Deterministic geometry for validated normalized regions."""

import math
import torch


def bbox_to_mask(region, height, width):
    """Half-open bounds, floor both endpoints (M1 convention); no dilation."""
    if type(height) is not int or type(width) is not int or min(height, width) < 1:
        raise ValueError('Mask dimensions must be positive integers')
    x0 = math.floor(region['x'] * width)
    x1 = min(width, math.floor((region['x'] + region['width']) * width))
    y0 = math.floor(region['y'] * height)
    y1 = min(height, math.floor((region['y'] + region['height']) * height))
    mask = torch.zeros((1, height, width), dtype=torch.float32, device='cpu')
    mask[:, y0:y1, x0:x1] = 1.0
    return mask
