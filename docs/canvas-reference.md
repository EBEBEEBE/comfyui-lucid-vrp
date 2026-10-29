# LuCiD Canvas editor reference

[Illustrated manual](canvas-tutorial.md) · [Image loaders](image-loaders.md) · [Configuration](configuration.md) · [Troubleshooting](troubleshooting.md)

The standard **VRP Canvas Image Loader** and **VRP Standalone Image Loader** open
this editor through **Edit canvas** or their **Edit Image** context-menu entry.
Changes are a draft until **Apply**. The Region node's separate **Edit mask**
continues to use the stock Mask Editor.

For the current Transform toolbar and its Accept/Discard reminder, see the
[illustrated Transform section](canvas-tutorial.md#transform). For the loader
node's controls and sockets, see [Working with images](image-loaders.md).

## Interface map

| Area | Controls |
| --- | --- |
| Header | Image/Mask toggle, saved/unsaved state, Undo/Redo, Reset panels, gear, shortcut help, Cancel, Apply |
| Left toolbar | Brush, Eraser, Transform, Fill, Eyedropper; unavailable tools hide in Mask mode |
| Left rail | Brush Size (1–250), Opacity, transparency preview; Hardness expands to the right of Size |
| Floating brush ball | Drag to move; click for Quick brush; F summons it at the pointer |
| Color panel | Hue and color field, HEX entry, preset swatches, up to ten recent colors |
| Layers / Mask panel | Layer operations in Image mode; independent selection and preview settings in Mask mode |
| Lower left | Hand toggle, zoom out/in, current zoom, Fit, Transform Whole Image |
| Contextual top bar | Transform or Fill settings for the selected tool |

Panels can float, dock and collapse. Drag the header of a floating panel to move
it. Image and Mask panel layouts are remembered separately. **Reset panels**
restores their placement and the quick-brush ball if the layout becomes awkward.

F summons Quick brush temporarily. Dismiss it with Escape or an outside click;
the ball returns to its last deliberately dragged position. An outside dismissal
consumes the entire press/drag/release, so only the next fresh press can paint.
Brush settings changed in the panel are retained.

## Layer types and ownership

| Type | Behavior |
| --- | --- |
| Background image | The loader's source; new imports allow transforms by default. Original pixels are read-only. Use separate paint or explicitly add/attach a child. Background cannot be deleted. |
| Imported image | Retains native pixels and editable placement, distortion and crop. Import inside Canvas adds a layer; import on the loader replaces its active source document. |
| Independent paint | Created with + / Shift+N. Supports paint, erase, fill, ordering and its own geometry. |
| Attached paint overlay | One paint child per image, indented below its parent row. Created on the first effective paint edit or explicitly with Add paint overlay. Follows image geometry and crop. |
| Independent mask | A single document selection, edited in Mask mode; not a paint child or a per-image clipping mask. |

Selecting an image or sampling color creates no child. Erasing an image with
no paint overlay does not erase its original pixels. Once there is an overlay,
Eraser removes its paint and reveals the image beneath. The overlay is not an
automatic alpha lock: paint can extend past the imported silhouette.

Blank documents begin with one editable Paint layer over the white frame.
Loader imports begin with Background plus independent Paint, without an
automatic child. Background never creates a child just because you brush it.
Reopening a saved document preserves its existing layers and lock flags.

Click a layer row to select it. **Ctrl+Click / Cmd+Click** in Image mode selects
the topmost visible paint-capable hit, preferring its usable paint child.
Hidden, paint-locked and zero-opacity targets are skipped; a miss retains selection.
The click does not paint or create history. This gesture is not active in Mask mode.

Use the eye and lock icons for visibility and protection. A parent's visibility,
crop and object opacity also govern its child. Its transform lock blocks shared
geometry, while the child's own paint lock controls painting independently.
Selecting a child for Transform targets the image and its overlay together.
An independent paint lock protects both pixels and geometry. Blocked actions
name the responsible layer and blink its lock icon, with a shake unless reduced
motion is enabled. Image transform locks do not block opacity, ordering or
deletion; paint locks block paint deletion, including through its parent.

Drag rows to reorder; use the insertion line and action label to identify the
drop. An image/child pair moves as one object. A child dragged to a root insertion
line detaches and reorders in one Undo operation. Up/down buttons are available
for ordinary ordering. Use the row menu to rename, duplicate or delete.

Plain **Delete**, while focus is in the Image layer panel, deletes the selected
unprotected layer or reports protection. An image's child is deleted with it.
Text fields and shortcut-capture controls keep their own Delete behavior.

**Detach paint overlay** makes the paint independent while retaining current
geometry. Inherited opacity is carried over; overlapping translucent pixels can
look different outside the image object. Undo restores the relationship.

The paired Transform toolbar's **Detach Child** button performs the same detach,
selects the detached paint and stays in Transform. It exits Crop/Distort editing
mode while preserving inherited geometry. The child's paint lock must be off;
its parent's transform lock can stay on. All content and unpaired layers do not
offer the button.

**Attach to image…**, **Attach paint layer…**, or dropping paint on the attachment
icon attaches empty paint immediately, and nonempty paint directly when the
relative geometry needs only a local offset. Otherwise **Bake and attach** asks
before resampling into new pixels and establishing a new local baseline. Detail
can soften; a scaled/warped destination may require baking even for untouched
paint. Undo restores the original. An image with a child cannot accept a second one.

## Paint, erase, fill and pick

| Control | Meaning |
| --- | --- |
| Size | Brush diameter; 1–250 |
| Opacity | Strength of newly painted/erased coverage; separate from layer opacity |
| Hardness | Edge falloff; 0 is soft, 100 is hard |
| Round / Square / Ink / Spray | Brush-tip choices in Quick brush; Spray builds coverage while held |
| Layer opacity | Changes the whole selected layer; image opacity applies to its image/overlay object |
| Fill Threshold | Connected-color tolerance, 0–255; higher accepts larger differences |
| Fill through | Uses visible RGB as the fill reference, while writing only to the active paint layer or mask |

With Fill through off, Fill samples the active layer, or mask coverage in Mask
mode. Filling an empty paint layer can fill the whole frame because its
transparent pixels are connected. Use Fill through to take boundaries from the
visible picture. Fill is not object recognition.

Eyedropper samples visible RGB without the mask-preview tint. The held picker
temporarily replaces Brush, Eraser or Fill in Image mode, then restores the tool
on release. It is configured as Alt, Q or Off. If Alt is intercepted by the
browser/OS, choose Q; interception cannot be reliably detected automatically.

Paint outside the output frame is retained and can be moved back into view.
Only the fixed frame contributes to the applied composite. Retention is bounded
by memory safeguards, not unlimited; a small visible document can still contain
large imported or off-frame sources.

## Transform, Distort and Crop

| Action | Result |
| --- | --- |
| Drag inside the transform outline, away from handles | Move the selected object |
| Snap to frame | Align moving transform bounds with frame borders within six screen pixels; gold edge feedback; enabled initially and remembered |
| Drag a corner | Scale; Keep Aspect Ratio preserves proportions, Shift temporarily releases that constraint |
| Drag the circular top handle | Rotate; Shift snaps to 15° steps |
| Flip / 90° buttons | Mirror or rotate in fixed increments |
| Scale… | Multiply current size by a percentage, 1–1000% |
| Detach Child | Detach the image's paint child, select it, and keep Transform active; one Undo restores attachment |
| Distort | Move four corners independently with a convex bilinear warp |
| Reset corners | Remove distortion, keep affine placement |
| Crop | Edit a reversible rectangular crop with four corners, mapped through current geometry |
| Reset crop | Reveal the uncropped source |
| Reset Geometry | Reset placement/scale/rotation and distortion for the selected layer; All content resets the collective transform; crop has its own reset |
| Accept / Enter | Keep this transform round and return to the previous tool; does not flatten or Apply the editor session |
| Discard / Escape | Restore the document and Undo/Redo history from before this transform round, then return to the previous tool |

A round starts when entering Transform and includes its Crop, Distort, flips,
resets and toolbar detachment operations. Individual operations remain undoable.
If the round is unchanged, an outside click exits without painting, and a layer
or tool switch proceeds. If changes are pending, outside clicks and attempted
switches reveal an expanding toolbar reminder; choose Accept or Discard. Blocked
actions are not replayed. Undo back to the entry state permits a clean exit.

The transformed outline has a 12-screen-pixel outside tolerance; handles have
protected hit areas. Outside drags are ignored rather than treated as exit
clicks. Pan and zoom work over handles too. Hand temporarily suspends transform
interaction without resolving the round. Right-button input never erases during
Transform. Popup and text-editing keys take precedence over round shortcuts.

Geometry remains editable after Apply and reopen. Crop's faint outside pixels
are an editing guide and do not appear in the applied composite. Transforming a
cropped image does not delete the excluded source pixels.

Frame snapping uses the displayed transform box, including transparent padding
and retained attached paint. Drag beyond the threshold to move freely off-frame.
It applies to movement of Layer, Image + overlay and All content, and adds no
extra Undo step. Corner scaling, rotation and Crop/Distort handles remain free;
other objects, centers and grids are not snap targets.

An image/paint pair uses a normal Transform cage covering both retained sources.
Crop and an existing Distort keep their actual editable boundaries, with a dashed
outline showing the full pair's extent. Both operate on shared image geometry;
detach the paint child for independent geometry.

**Transform Whole Image / All content** moves, scales and rotates every object, including
locked layers, inside the fixed frame. **Include mask** controls whether the
independent mask also follows. Individual Crop/Distort controls are unavailable
for this whole-composition target. Document resizing belongs to the loader's
**Resize current**, not the editor.
Invoking Transform Whole Image from Mask switches to Image mode so its toolbar
and Accept/Discard controls remain available.

Distort previews may use reduced detail while dragging, with full rendering on
Apply. GPU previews have a CPU fallback. Perspective is a warp of existing pixels,
not a new camera view or a content-generating operation.

## Independent mask

In Mask mode, Brush adds coverage, Eraser removes it, and Fill edits connected
coverage. Transform and Eyedropper hide. Image layers and RGB paint remain intact.

- **Show overlay:** hide/show the coverage display without clearing the mask.
- **Preview color / Overlay opacity:** appearance only; default black at 45%.
- **Clear / Invert:** remove coverage or exchange selected/unselected values.
- **Grow / shrink:** expand/contract coverage using +/− or the wheel inside its
  box; radius is 1–16 pixels per step. A wheel burst creates one Undo entry.

Brush opacity affects authored coverage; overlay opacity does not. After Apply,
the loader's MASK uses 1/white for selected and 0/black for unselected. The mask
follows the loader's IMAGE alignment choice. It does not erase RGB, create an
inpainting latent, or automatically become a regional prompt. See
[External MASK](regions.md#external-mask) for regional wiring.

## Keyboard and pointer reference

These are built-in defaults. Installation/user settings can override the fifteen
configurable bindings; **?** in the header shows current bindings.

| Action | Default |
| --- | --- |
| Brush / Eraser | B / E |
| Transform / Fill / Eyedropper | V / G / I |
| Toggle Image/Mask | M |
| Summon Quick brush / open color | F / C |
| New independent paint layer | Shift+N |
| Smaller / larger brush | [ / ] |
| Softer / harder brush | Shift+[ / Shift+] |
| Select layer above / below | Page Up / Page Down |
| Temporary RGB picker | Hold Alt; Q or Off available in Preferences |
| Select editable layer at pointer | Ctrl+Click / Cmd+Click, Image mode |
| Delete selected layer / report protection | Delete with focus in the Image layer panel |
| Undo | Ctrl+Z / Cmd+Z |
| Redo | Ctrl+Shift+Z / Cmd+Shift+Z; Ctrl+Y also works |
| Brush opacity | 1–9 = 10–90%; 0 = 100% |
| Pan | Hold Space and drag, middle-button drag, or enable Hand and left-drag |
| Zoom | Wheel over the canvas; +/− and Fit buttons also available |
| Adjust a control | Wheel over brush controls, layer opacity, mask-preview opacity or Fill Threshold |
| Grow / shrink selection | Wheel inside the mask Grow / shrink box |
| Context menu | Right-click under the selected behavior; Shift+F10 or context-menu key |
| Cancel a current gesture / close popup | Escape |
| Accept / discard a transform round | Enter / Escape; open popups and text editing take precedence |

Shortcuts need focus inside the editor. Text fields keep typing behavior. For
custom bindings, open the gear, expand **Customize shortcuts**, click a binding
and press a letter, bracket or navigation key, optionally with Shift. Backspace
clears it. Conflicts are rejected. Undo/Redo, Escape, Space and number-opacity
keys retain their standard roles.

## Right-button behavior

| Preference | Canvas behavior in Image and Mask |
| --- | --- |
| LuCiD (default) | Stationary click opens actions; movement of at least 3 CSS pixels starts erasing |
| Classic | Right button erases; use Shift+F10 for viewport actions |
| Menu only | Right-click opens actions; no right-button erasing |

Panel menus do not change with this preference. A viewport menu targets the hit
layer without selecting it for subsequent paint. Explicit Transform selects its
target; creation commands select the new layer. A row's menu targets that row.
During Transform, all three preferences disable right-button erasing; modifying
menu actions respect the pending-round guard.

## Preferences, Apply and saved workflows

Normal controls silently recall brush size/opacity/hardness, recent colors,
mask-preview color/opacity, quick-brush position and separate panel layouts.
The gear configures behavior and shortcuts, with optional reset utilities.
Preferences are per ComfyUI user in managed `vrp/canvas_preferences.json`, not
image state. They survive Cancel and do not enter image Undo. See
[configuration](configuration.md#image-editor-behavior) for installation defaults
and invalid/missing-file fallback behavior.

**Apply** commits the draft as one loader edit turn and saves the composite,
mask, editable layer assets and geometry. **Cancel** discards the draft image
changes. Editor Undo tracks individual edits only for the current open session.
Loader Undo/Redo tracks completed document turns, sharing 50 snapshots by default
across both stacks. Set `loader_history_limit` (1–1000) in
[configuration](configuration.md#loader-undoredo-history) to change that depth.
Reopening does not restore the preceding session's stroke history.

Save the workflow and keep referenced files. Workflow JSON alone is not a
self-contained layered-image bundle. Retaining an off-frame stroke in editor
metadata does not add its pixels outside the fixed IMAGE output.

There is no direct image-file/PSD export or Photoshop bridge in this version.
Use a downstream **Save Image** node for the composite. Multiple paint children,
per-image masks, path crop, pressure sensitivity and editable stroke replay are
outside the current editor scope. See [limits](limitations.md) for host and
memory boundaries.
