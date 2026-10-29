# Third-party notices

This file distinguishes redistributed adapted code from external host APIs,
and format references. The project's own MIT license is in
[LICENSE](LICENSE). These notes do not relicense external projects or models.

## Adapted Anima regional-conditioning logic

Portions of `anima_regional.py` are adapted from:

https://github.com/Sen-sou/Comfyui-Anima-Regional-Conditioning

Copyright (c) 2026 Vikas Vishwakarma

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

ComfyUI Prompt Control was inspected as a behavior/API reference only. Its
GPL implementation is not copied or used by this project.

## MOSS-Image interoperability

The experimental `moss_visual_regional_prompt_experimental.py` node implements
VRP state/mask conversion to the documented [MOSS-Image layout format](https://github.com/OpenMOSS/MOSS-Image#layout-generation).
Its frontend reuses this project's VRP controls. Optional conditioning calls the
connected ComfyUI CLIP object's tokenization and scheduled-encoding APIs.

The node pack does not bundle OpenMOSS inference code, model weights, or text
encoder weights. OpenMOSS identifies its standalone pipeline code as
[Apache-2.0](https://github.com/OpenMOSS/MOSS-Image/blob/main/LICENSE). That is
the upstream pipeline's license, not a replacement license for VRP. Users obtain
model files separately under their respective terms. Any future redistribution
or adaptation of upstream code/assets must retain the applicable license and
notices; this format-reference entry does not substitute for those obligations.

## LuCiD Canvas and host integration

LuCiD Canvas uses project-local editor, geometry, raster, worker and rendering
modules with browser Canvas 2D/WebGL APIs. It does not bundle an external canvas
editor or icon/font package. Absence of a package dependency
does not itself establish the origin or license of a supplied asset.

ComfyUI and ComfyUI_frontend supply the host node APIs, native text/VAE encoding,
Clipspace and the stock Region Mask Editor. Their implementations and licenses
remain with those separately installed projects. 