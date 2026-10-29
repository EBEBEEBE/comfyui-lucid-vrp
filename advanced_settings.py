"""Versioned expert controls for the existing Anima regional-routing patch."""

import math


ADVANCED_SETTINGS_TYPE = "VRP_ADVSETTINGS"
BASE_MODES = ("disabled", "uncovered_only", "global")
PRESETS = ("VRP Recommended", "Sen-sou Upstream Defaults", "Custom")

ADVANCED_FIELDS = (
    "base_mode",
    "base_strength",
    "start_percent",
    "end_percent",
    "cross_mask_strength",
    "self_mask_strength",
    "base_ratio",
    "cross_inject_every",
    "self_inject_every",
)

# Project defaults. base_ratio was explicitly promoted to 0.31 after user
# comparisons; the upstream comparison preset below remains unchanged.
VRP_RECOMMENDED = {
    "version": 1,
    "base_mode": "global",
    "base_strength": 0.20,
    "start_percent": 0.0,
    "end_percent": 1.0,
    "cross_mask_strength": 1.0,
    "self_mask_strength": 0.20,
    "base_ratio": 0.31,
    "cross_inject_every": 1,
    "self_inject_every": 1,
}

DEFAULT_ADVANCED_SETTINGS = VRP_RECOMMENDED

# Values from the Sen-sou README's recommended/default regional patch table.
SENSOU_UPSTREAM_DEFAULTS = {
    "version": 1,
    "base_mode": "disabled",
    "base_strength": 0.20,
    "start_percent": 0.0,
    "end_percent": 0.35,
    "cross_mask_strength": 1.0,
    "self_mask_strength": 0.20,
    "base_ratio": 0.10,
    "cross_inject_every": 1,
    "self_inject_every": 1,
}


def _finite_number(value, name):
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def validate_advanced_settings(value):
    """Return a fresh validated settings dict; reject unknown fields."""
    if not isinstance(value, dict):
        raise ValueError("advanced_settings must be a VRP_ADVSETTINGS object")
    expected = {"version", *ADVANCED_FIELDS}
    if set(value) != expected:
        raise ValueError("VRP_ADVSETTINGS has invalid fields")
    if type(value["version"]) is not int or value["version"] != 1:
        raise ValueError("Unsupported VRP_ADVSETTINGS version; expected integer 1")
    if value["base_mode"] not in BASE_MODES:
        raise ValueError(f"base_mode must be one of {BASE_MODES}")

    result = {"version": 1, "base_mode": value["base_mode"]}
    ranges = {
        "base_strength": (0.0, 10.0),
        "start_percent": (0.0, 1.0),
        "end_percent": (0.0, 1.0),
        "cross_mask_strength": (0.0, 1.0),
        "self_mask_strength": (0.0, 1.0),
        "base_ratio": (0.0, 1.0),
    }
    for name, (minimum, maximum) in ranges.items():
        number = _finite_number(value[name], name)
        if not minimum <= number <= maximum:
            raise ValueError(f"{name} must be between {minimum} and {maximum}")
        result[name] = number
    if result["start_percent"] > result["end_percent"]:
        raise ValueError("start_percent must not exceed end_percent")
    for name in ("cross_inject_every", "self_inject_every"):
        number = value[name]
        if type(number) is not int or not 1 <= number <= 100:
            raise ValueError(f"{name} must be an integer between 1 and 100")
        result[name] = number
    return result


def settings_for_preset(preset):
    if preset == "VRP Recommended":
        return dict(VRP_RECOMMENDED)
    if preset == "Sen-sou Upstream Defaults":
        return dict(SENSOU_UPSTREAM_DEFAULTS)
    if preset == "Custom":
        return dict(VRP_RECOMMENDED)
    raise ValueError(f"Unknown VRP advanced-settings preset: {preset}")


def make_advanced_settings(
    preset,
    base_mode,
    base_strength,
    start_percent,
    end_percent,
    cross_mask_strength,
    self_mask_strength,
    base_ratio,
    cross_inject_every,
    self_inject_every,
):
    if preset != "Custom":
        return validate_advanced_settings(settings_for_preset(preset))
    return validate_advanced_settings({
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
