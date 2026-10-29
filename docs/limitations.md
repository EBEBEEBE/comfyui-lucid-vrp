# Compatibility and limitations

[Introduction](../README.md) · [Troubleshooting](troubleshooting.md)

## Supported setup

LuCiD VRP uses **classic ComfyUI**; Nodes 2.0 and general subgraph support are
not currently supported. The [installation prerequisites](../README.md#prerequisites)
list the required Python and model components.

The image loaders and LuCiD Canvas can be used with other image workflows.
Editing an image or mask with latent mode **Off** does not need a model or VAE.
For latent encoding, use a VAE compatible with your generation model. Special
multi-stage pipelines, such as Stable Cascade, may need their own latent nodes.
See [Working with images](image-loaders.md#choose-a-latent-mode).

The current development setup is **ComfyUI 0.42.0 with frontend 1.57.1**.

Anima regional prompting, the image loaders, and LuCiD Canvas have also
been tested with:

| ComfyUI | Frontend |
| --- | --- |
| 0.32.0 | 1.48.7 |
| 0.37.0 | 1.53.6 |

MOSS-Image generation requires native MOSS-Image support, which is absent
from those older versions.

## Regional prompting

**Anima regional prompting** guides where prompts have influence; it does not
lock objects to their boxes or prevent attributes from appearing elsewhere.
Painted and external masks can help describe more complex shapes, but they do
not protect pixels from sampling. Inpainting, regional LoRA, and ControlNet
require separate tools or workflows. Anima Core does not accept a masked
inpainting latent.

The **MOSS - Visual Regional Prompt** node creates MOSS-Image
layout instructions. It converts each incoming mask to one enclosing rectangle;
regional negatives and fractional region strength do not carry over. Use a
global negative with MOSS instead. The node does not provide regional prompting
for other model families. See [MOSS layout prompting](moss-layout.md) for the
conversion details.

VRP preserves existing model wrappers and patches, but extensions that modify
the same Anima attention operations can conflict. If a workflow behaves
unexpectedly, establish a baseline with those extensions disabled. Anchor-Q and
Cross-Attn Mixer combinations are not generally supported. Scheduled regional
conditioning with multiple conditioning entries is also unsupported.

## Editing images

The loaders work with **single still images**, not animation or video. Canvas
keeps the output frame fixed while you move, transform, distort, or crop its
contents. To change the output dimensions, use the loader's **Resize current**
control.

Canvas supports one attached paint overlay per image. It does not provide
per-image masks, arbitrary layer groups, pressure-sensitive painting, or direct
PSD export. To save the composite as an image, connect the loader's `image`
output to a ComfyUI **Save Image** node. See the [Canvas manual](canvas-tutorial.md)
for its editing tools and [editor reference](canvas-reference.md) for controls.

<a id="no-garbage-collection"></a>

## Images and editor files

A workflow saves document state and references to images, layers, and masks; it
does not bundle all of those files. When moving a workflow or clearing ComfyUI's
input or temporary storage, keep the files it needs. Missing files can prevent
an image, mask, or editable layer from reopening.

VRP does not automatically delete unused editor and derived files. Reducing the
loader history limit does not delete them either. If a region or image is
missing after reopening a workflow, see [Troubleshooting](troubleshooting.md#missing-images-or-editor-layers).

## Performance

Larger canvases, more regions, and longer prompts can increase sampling time
and memory use. Imported images, retained edits, and paint outside the visible
frame also use memory while editing. If Canvas reports a memory limit, see the
[raster budget guidance](troubleshooting.md#canvas-reports-a-raster-budget-error).

Anima regional settings can add an extra model pass. Setting `base_ratio` to
zero removes that pass, but also changes the result. The [advanced settings
guide](advanced-settings.md#performance) explains how to compare performance
and what to expect from attention backend settings.
