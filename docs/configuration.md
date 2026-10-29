# Configuration

[Introduction](../README.md) · [Node reference](nodes.md)

Configuration is optional. Copy `vrp_config.example.json` to
`vrp_config.json` in the plugin's root folder, beside `__init__.py`.
Edit the copy, then restart ComfyUI and refresh the browser.

The file uses JSON: use double quotes, lowercase `true`/`false`, and no
comments or trailing commas. The personal file is Git-ignored.
If it is absent, VRP uses built-in defaults.

## A small example

This adds a fixed preset and changes the region-list height:

```json
{
  "version": 1,
  "canvas_presets": {
    "Landscape 1600": [1600, 800]
  },
  "ui": {
    "list_height": 190
  }
}
```

You do not need to repeat every setting. Valid supplied entries merge into the
built-in configuration. A custom preset adds to the shipped presets; using an
existing name overrides that preset's dimensions.

## Available settings

| Key | Accepted value | Purpose |
| --- | --- | --- |
| `version` | Integer 1 | Required configuration format |
| `debug` | Boolean | Register the three Legacy node presentations |
| `minimalstepgranularity` | Integer 0, 1 or 2 | Loader alignment/minimum Step: 32, 16 or 8 pixels respectively; default 0 |
| `loader_history_limit` | Integer 1–1000; default 50 | Maximum document snapshots shared by loader Undo and Redo |
| `canvas_presets` | Object of names to [width, height] | Add or override fixed resolution presets |
| `status_colors` | Object with ok / info / warning / error entries | Customize status backgrounds and text |
| `ui` | Object with the values below | Adjust list and status layout |
| `default_regions` | Array of internal regions | Starting boxes/prompts for newly created Core nodes |
| `canvas_editor` | Object described below | Default image-editor mouse behavior and shortcuts |

Preset dimensions must be integer multiples of 8 from 8 through 4096. Valid
presets are rounded up to the configured loader grid, with a startup warning
when their dimensions change.
Names cannot be blank, have surrounding spaces, or be `Custom`
(case-insensitive). New names must not differ only by case from an existing
name. Labels do not calculate sizes; the two numbers do.

### Loader alignment and minimum Step

The default is a **32-pixel grid**. To opt into a smaller grid, add
`"minimalstepgranularity": 1` for 16 pixels or `2` for 8 pixels. Missing or `0`
selects 32. Strings, booleans and other values fall back to 32 with a warning.
Restart ComfyUI and refresh the browser after changing it.

The setting controls working-view alignment and the minimum Create/Resize Step.
Step 32 is the default for new loaders, including when 16/8 are enabled. Choices
below the configured minimum are hidden. Saved valid Step selections are retained.
On workflow load,
pending dimensions round up within the size-control bounds and an unsupported
Step moves to the next allowed choice. The info field reports adjustments.

**8/16 are compatibility overrides:** some image models need dimensions divisible
by 32. Use compatible dimensions and the matching VAE; an incompatible VAE size
is rejected rather than silently cropped. Smaller grids show a compatibility
notice in the loader. See [troubleshooting](troubleshooting.md#loader-grid).

The current policy is applied to restored working views and Undo/Redo too.
Original image files, source dimensions, editable layers and history documents
are preserved. Only pending controls and derived working geometry are normalized.

Each status-color entry must contain `background` and `text` as six-digit hex
colors, for example:

```json
{
  "version": 1,
  "status_colors": {
    "warning": {"background": "#57452b", "text": "#f5e4bf"}
  }
}
```

| UI key | Default | Integer range |
| --- | --- | --- |
| `list_height` | 160 | 90–400 |
| `row_height` | 30 | 24–48 |
| `status_padding` | 5 | 3–12 |
| `font_size` | 12 | 10–16 |

Megapixel presets are not configurable.

### Loader Undo/Redo history

Both Image Loaders retain **50 document changes by default**, shared between
Undo and Redo. Set `"loader_history_limit": 100`, for example, to retain up to
100. Accepted values are integers from 1 through 1000; invalid values warn and
fall back to 50. Restart ComfyUI and refresh the browser after changing it.

Import, Create blank, Resize, Restore and editor Apply consume document turns.
This setting does not change the open Canvas editor's individual-operation
history or raster-memory safeguards. New changes after Undo clear Redo.

When opening a workflow above the configured limit, VRP removes the oldest Undo
entries first, then the farthest Redo entries if needed. The current document,
revision and retained Last blank / Last imported sources are preserved. Missing
`redo` in older workflows still migrates to an empty Redo stack. Raising the
limit cannot recover snapshots that were already discarded.

The limit bounds saved history metadata; it does not delete image files or cap
disk usage. Remaining counts are not displayed in this release.

## Image editor behavior

The editor's gear button configures right-button behavior and shortcuts for your
ComfyUI user. First use offers **Use defaults** or **Configure**; either can be
skipped while editing. Changes take effect immediately in the current editor
and apply the next time you open either loader's editor.

For illustrated controls, see [Preferences and input](canvas-tutorial.md#preferences-and-input)
in the Canvas manual.
The [editor reference](canvas-reference.md#keyboard-and-pointer-reference)
lists the built-in bindings and mouse gestures.

| Option | Choices | Built-in default |
| --- | --- | --- |
| Right mouse button | `lucid`: click for actions, drag at least 3 pixels to erase; `classic`: erase without a canvas menu; `menu`: actions without erasing | `lucid` |
| Held color picker | `alt`, `q`, `off` | `alt` |

Right-button choices affect the canvas in both Image and Mask modes. Layer-panel
menus remain unchanged. Shift F10 opens canvas actions even in Classic mode.
The held picker temporarily samples visible RGB for Brush, Eraser or Fill and
restores the current tool on release. Choose Q if your browser intercepts Alt;
the editor cannot reliably detect interception by the browser or operating system.

In Image mode, **Ctrl+Click** (or **Cmd+Click**) selects the topmost visible,
unlocked editable layer under the pointer. Images prefer their attached paint
overlay; selection alone never creates one. The current tool stays active, the
click does not paint, and selection does not enter Undo history. A miss keeps
the current selection. The chosen layer briefly highlights in the layer list.

Expand **Customize shortcuts**, focus a binding and press a key. Backspace clears
it. Letters, brackets and navigation keys support an optional Shift modifier.
Conflicting assignments are rejected; clear the other binding first. Space,
number opacity keys, Escape and standard Undo/Redo are reserved. Text fields
keep normal typing behavior. **Reset behavior / shortcuts** restores the defaults.

During Transform, Enter accepts the round and Escape discards it; an open popup
or text field handles its keys first. Right-button erasing is suspended during
Transform and Hand navigation, regardless of the saved right-button style.

You can supply installation defaults in `vrp_config.json`:

```json
{
  "version": 1,
  "canvas_editor": {
    "rightButton": "lucid",
    "temporaryPicker": "alt",
    "shortcuts": {"brush": "P", "add": "Shift+N"}
  }
}
```

Shortcut action names are `brush`, `eraser`, `move`, `fill`, `pick`, `mask`,
`quick`, `color`, `add`, `smaller`, `larger`, `softer`, `harder`, `above`, and
`below`. Use an empty string to leave an action unbound. Invalid/conflicting
values fall back to working defaults. Installation defaults require a ComfyUI
restart and browser refresh; per-user choices override those defaults.

Brush size, opacity and hardness, ten recent colors, mask-preview tint/opacity,
quick-brush position, separate layer/mask panel layouts, and Transform's
Snap to frame toggle are remembered
silently through their normal controls. There is no setup requirement for recall.
These values and per-user behavior overrides live in managed
`vrp/canvas_preferences.json` inside ComfyUI user data. Automatic saves never
rewrite `vrp_config.json` or enter image Undo history; Cancel retains preferences.
Missing/invalid fields have safe defaults. Storage failure leaves editing usable
with a nonblocking notice. Reset utilities can restore panels or remembered state
without changing image pixels.

## Default internal regions

This example gives newly created Core nodes one centered box:

```json
{
  "version": 1,
  "default_regions": [
    {
      "id": "starter-region",
      "label": "Subject",
      "x": 0.25,
      "y": 0.25,
      "width": 0.5,
      "height": 0.5,
      "prompt": "",
      "negative_prompt": "",
      "weight": 1.0
    }
  ]
}
```

Coordinates are normalized proportions of the canvas. Each region needs a
unique nonempty ID, a nonempty label, both prompt strings, a weight from 0 to 1,
and a positive rectangle. Keep the rectangle within 0–1 on each axis.

These defaults apply to new nodes after restart. They do not replace regions
or document states already saved in a workflow.

## Legacy nodes

Set `"debug": true` alongside `"version": 1` to additionally register:

| Display name | Workflow ID |
| --- | --- |
| VRP Canvas Image Loader (Legacy) | `VRPCanvas` |
| VRP Region (Legacy) | `VRPRegion` |
| Anima VRP (Legacy) | `AnimaVRP` |

The standard eight nodes remain available. Legacy nodes use the same backends
with their older presentation, under the same **LuCiD VRP** category.

Turning debug off removes these registrations at the next restart; workflows
containing them will show missing nodes until you enable them again or replace
them. The experimental Canvas Builder and M1 Proof are not enabled by debug.

## If a setting does not apply

Check ComfyUI's terminal for a `VRP config` warning. An unreadable file or
unsupported version uses built-in defaults. With version 1, invalid entries
fall back individually; unknown keys are ignored with a warning.

Confirm the file is named `vrp_config.json` rather than
`vrp_config.json.txt`, and that it is beside the plugin's Python files.
Restart and refresh after changes. Configuration is read at startup, not
while the editor is running.
