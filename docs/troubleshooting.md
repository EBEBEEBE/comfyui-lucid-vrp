# Troubleshooting

[Introduction](../README.md) · [Node reference](nodes.md) · [Compatibility and limitations](limitations.md)

Start with the message on the node and the first related error in ComfyUI's
terminal. The sections below cover common setup, editing, and generation issues.

<a id="the-anima-vrp-category-is-missing"></a>

## Nodes are missing or the editor does not appear

Restart ComfyUI after installing or updating VRP, then refresh the browser. If
the interface has not updated, try a hard refresh. Enable classic nodes;
Nodes 2.0 is unsupported.

The category is **LuCiD VRP**. For ZIP installs, check that the custom-node
folder contains `__init__.py` directly, rather than another repository folder.
Check the startup log for an import error and confirm that ComfyUI uses Python
3.11 or newer. VRP needs no extra pip packages beyond a working ComfyUI setup.

Legacy nodes are available through [debug mode](configuration.md#legacy-nodes).

## I changed Width/Height, but the canvas stayed the same

Width and Height are proposed dimensions until you apply them. Open **Create /
Resize**, then press **Create blank** to start a new document or **Resize
current** to stretch the existing image and its editor layers. Preset, Step,
and Swap only change the proposal.

See [create and resize](image-loaders.md#create-or-resize).

## Canvas paints on an unexpected layer

Check the highlighted row before painting. Opening a context menu over a visible
object does not automatically select it as the next paint target. Click its row,
or use **Ctrl+Click / Cmd+Click** in Image mode to explicitly pick an editable
layer at the pointer. An image with a usable attached paint child selects that
child. A miss leaves the active row unchanged.

Painting an imported image creates its single attached paint overlay
on demand. Eraser removes overlay paint, not the imported image's original pixels.
Unlock the paint child itself for painting; a parent's transform lock can stay
on. Transforming the pair requires unlocking its parent. A blocking lock's icon
blinks and shakes, and the notice names that layer. Background never creates a
child automatically: use independent Paint, or explicitly add/attach an overlay.
See [layer ownership](canvas-reference.md#layer-types-and-ownership).

## Canvas shortcuts or Alt picking do not work

Click the canvas to give the editor focus. Text fields retain normal typing
keys, and shortcut bindings may have been customized. Open **?** for the current
bindings or the **gear** to change them. If the browser or operating system takes
Alt, choose **Q** as the temporary picker. VRP cannot reliably detect intercepted
keys. The temporary picker is for RGB paint tools, not Mask mode.

## The mask looks black or a different color

Canvas defaults to a black preview at 45% opacity. Change **Preview color** and
**Overlay opacity** in Mask mode, or uncheck **Show overlay**. These affect only
display. Brush opacity affects actual mask coverage. The loader preview uses
its separate pink tint; output MASK coverage is independent of both colors.

## Canvas reports a raster budget error

The visible frame may be small while the document still holds large imported
images, off-frame paint, or earlier edits in Undo history. These all use memory.

Undo an accidental huge edit, remove unneeded layers, or prepare smaller source
images before importing. Resizing the loader's output frame does not necessarily
reduce the memory used by retained source images. Closing Canvas releases session
resources, but reopening still needs the saved assets. If ordinary small edits
repeatedly trigger the error, keep a copy of the workflow and source files for a
problem report.

## Crop or Transform Whole Image did not change the output dimensions

Layer Crop hides part of an object without deleting its source pixels. Transform
Whole Image changes the artwork's scale and placement inside the fixed frame.
To change output dimensions, Apply and close Canvas, then use **Resize current**
on the loader. See [Crop](canvas-tutorial.md#crop).

## Auto asks for a VAE

Auto uses Empty for a blank-origin document whose RGB pixels are still white.
Imported images and RGB-painted blanks resolve to Encode and need a VAE.

Connect a VAE compatible with your image model. Alternatively, choose Empty for
a fresh latent or Off for an image-only branch. Empty does not encode the image.

## The latent output is Off

Off disables the latent output. Disconnect it if you only need the image and
mask, or choose Empty, Encode, or Auto to supply a latent.

You can supply Core with a separate compatible Anima latent, but its spatial
dimensions must match the regional canvas.

## Canvas and latent dimensions disagree

Feed Core a latent matching the same committed canvas size used by its Regions.
Check the loader's **Working** size, particularly after a resize or alignment
change. IMAGE dimensions can differ when **Apply to IMAGE output** is OFF.

An error mentioning a stale canvas snapshot means Core's saved editor size and
its connected canvas disagree. Let the connected loader finish loading and
check its live preview before queueing again.

## An external Region does not appear

Check the wiring from the loader to the final Region and into Core:

- `canvas` goes to the next node's `canvas`.
- `regions` goes to the next Region's `previous_regions`, then Core's `regions`.

The canvas relay alone does not transfer region data. Check that Weight is
above 0, the node is active, and Region source matches the geometry you authored.
An External MASK producer may need to execute before its current mask can be
previewed. See [the wiring table](regions.md#connect-external-regions).

## A region needs geometry, has an empty mask, or is too small

In BBox mode, draw a box. In Painted Mask mode, use **Edit mask**, paint a
selection, and save. In External MASK mode, connect the mask input.

If you intentionally want an inactive region, set Weight to 0. An active mask
with no selected area cannot route a prompt. Very thin/small shapes can vanish
on Anima's token grid; enlarge the selected area.

## External MASK dimensions do not match

Use one mask at the working canvas size or the canvas size divided by 8 on
each axis. VRP rejects other dimensions and mask batches.

A loader's `mask` output follows its IMAGE dimensions. Enable **Apply to IMAGE
output** when using that mask against its aligned regional canvas.

## A region belongs to another canvas document

A Region chain belongs to its connected canvas, including its document identity
and revision. Two independently loaded canvases are not interchangeable just
because they have the same dimensions.

Reconnect the Region chain to the intended Canvas loader and run it against
that canvas. Use its final canvas relay and region bundle together at Core.
Do not combine a cached bundle from one loader with another loader's canvas.

## Missing images or editor layers

Workflow JSON stores references to files, not copies of the files. Restore
missing images/masks/editor layers to their original locations, or import the
source again and re-author the affected edits.

If the RGB composite still exists but editor layers are missing, explicitly
import that composite as a new image to continue from flattened pixels.
This does not recover the separate layers.

Undo/Redo validates the destination's files before changing history. If a restore
fails, recover those files before retrying. Avoid cleaning referenced temp files
while relying on saved editor states.

## Undo or Redo is unavailable

The loader keeps up to 50 snapshots across Undo and Redo by default. Change
`loader_history_limit` in [configuration](configuration.md#loader-undoredo-history)
to adjust that depth. A new committed change after Undo clears Redo. The loader
restores saved document states, not individual Canvas brush strokes.

For the most recent blank-origin or imported source, also check **Restore source**
and its **Last blank** / **Last imported** entries.

## A mask is visible, but the whole image still changes

Regional masks control prompt placement. They do not protect pixels from
sampling. Your sampler's denoise setting and latent determine how strongly an
img2img source changes. VRP's Core does not implement masked inpainting and
rejects a latent carrying a `noise_mask`.

## Prompt Combine is missing some text

It reads external Region chains, not Core's internal boxes. Connect the final
Region's `regions` to `vrp_region` directly.

Weight-zero regions and empty text are omitted. Muted/disconnected producers
do not supply cached text. For an independent branch, bypassing Core alone is
enough; keep the Region producers it needs available.

## Generation is slow

Regional conditioning adds processing time and memory use. Larger canvases,
more regions, and longer regional prompts can increase the cost.

By default, `base_ratio` blends the regional result with an additional
original-model prediction. The default value is **0.31**.

- Any value above **0** requires the additional model pass, even **0.01**.
- Setting it to **0** removes that pass, but can change composition and coherence.
- The value controls the blend between predictions; it does not represent
  the percentage increase in processing time.

VRP’s patched attention uses **PyTorch scaled dot-product attention (SDPA)**.
Selecting FlashAttention or SageAttention in ComfyUI does not automatically
apply that backend to these calls. Performance depends on your GPU, PyTorch
installation, and workflow.

If generation is too slow, compare the result with `base_ratio = 0`. For memory
pressure during sampling, try a smaller canvas or fewer regions.
**Tiled VAE encoding** can help with encoding memory use, but does not reduce
the memory needed for regional sampling.

## A region disappears after reopening or duplicating a workflow

Save a copy of the affected workflow before changing it further. Check Weight,
connections, Region source, and missing-file errors first.

If the problem persists after restarting and reloading, record the steps used to
save, reopen, or duplicate the workflow. Include the before-and-after workflows
and any missing-file messages when reporting the issue.

<a id="loader-grid"></a>

## Loader dimensions or Step change when opening a workflow

The default loader grid is **32 pixels**. Create / Resize dimensions round up
within their allowed bounds, and unsupported Step values move to an allowed
choice. Crop, Pad, or Stretch determines the working view; the info field reports
any adjustments.

Alignment creates a working view without overwriting the source image or its
editable layers. **Edit canvas** opens the retained source. **Apply to IMAGE
output** chooses whether IMAGE and MASK use the source or working dimensions.

To use a smaller grid, set `minimalstepgranularity` in `vrp_config.json`:
`0` (or missing) means 32, `1` means 16, and `2` means 8. Restart ComfyUI and
refresh the browser. Smaller grids show a compatibility notice: some models
require dimensions divisible by 32. See [configuration](configuration.md#loader-alignment-and-minimum-step).

## Encode options are disabled or a saved mode asks for a VAE

Connect a compatible VAE to the loader's `vae` input. Encode and Encode (Tiled)
become available without queueing. If a saved encoding mode asks for a missing
VAE, reconnect it or choose another mode. Auto also needs a VAE when it resolves
to Encode for an imported or RGB-painted image. Empty needs no VAE; Off disables
the latent output.

## The VAE reports incompatible working dimensions

The working dimensions must be divisible by the connected VAE's compression
factor. Resize to dimensions that meet the requirement in the error message, or
restore the default grid where appropriate. For example, a 16-grid size of 1040
is not divisible by 32. Alignment and failed encoding leave the source file
unchanged.

## Empty latent and encoded latent have different shapes

Empty uses ComfyUI's native placeholder contract. A compatible sampler uses its
MODEL to resolve the channels and dimensional layout. Encode/Tiled use the
connected VAE and preserve its native output. Raw placeholder and encoded tensor
shapes can therefore differ before sampling. Use matching MODEL/VAE components;
specialized multi-stage pipelines and samplers that bypass native adaptation may
need their own native latent nodes.

Connecting Empty directly to VAE Decode or VAE Decode (Tiled) can fail when the
placeholder does not match that VAE. For example, the generic 4-channel, 4D
placeholder is not an Anima/Wan 16-channel, single-frame 5D latent. The tiled
decoder may report `tuple index out of range` while estimating its memory needs.
Decoders do not perform the MODEL-driven adaptation that compatible samplers do.
Use the sampler's output for decoding, or a model-specific empty-latent node if
direct decoding is intentional. Use the loader's IMAGE output to view the blank
canvas. This mismatch is expected before adaptation; the same error after
sampling or native VAE encoding needs separate investigation.

## MOSS boxes or text do not match the intended layout

Check the connections described in the [MOSS guide](moss-layout.md). Connect
both the final Region's `canvas` and `regions`; the relay alone does not
carry its captions or boxes. Incoming entries are edited in their owning Region
nodes, while Add/Delete and Include region apply to internal boxes.

Match generation width/height to the Canvas working size, divisible by 16.
For text-only export, disconnect MOSS's `clip` and use Canvas latent Off or Empty.
A connected CLIP loader still executes when text outputs are requested. Without
CLIP, conditioning consumers are skipped while JSON/text outputs stay usable.

A connected `negative_prompt`, including an empty string, overrides and disables
the local negative field. Regional negatives and fractional weights are not
represented in MOSS layout conditioning. Masks become enclosing rectangles;
thin or disconnected shapes do not retain their exact outlines. Keep position
words in scene/subject text consistent with the boxes.

## Reporting a problem

Include:

- Exact error text and the relevant ComfyUI terminal traceback.
- ComfyUI, frontend, Python, and VRP revision/version if known.
- A small workflow that reproduces it, plus any source files it needs.
- Steps from opening the workflow to the failure, and whether restart/reload helps.
- For performance issues: hardware, canvas size, region count, sampler settings,
  advanced settings, and measured encoding/sampling times.

Check shared workflows and images for prompts, paths, or metadata you do not
want to publish. Screenshots help explain layout, but a workflow is usually
more useful for reproducing a connection or restoration problem.
