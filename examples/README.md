# Sample workflows

These JSON files contain the workflows embedded in the
[full documentation](https://github.com/EBEBEEBE/comfyui-lucid-vrp/blob/main/README.md).
Drag a JSON file into classic ComfyUI and select your installed model files.

| Workflow | Use |
| --- | --- |
| [anima-minimal.json](anima-minimal.json) | Anima with internal regional boxes |
| [anima-external-regions.json](anima-external-regions.json) | Anima with separate Region nodes |
| [anima-image-to-image.json](anima-image-to-image.json) | Image-to-image composition with Anima regions |
| [moss-sft-layout.json](moss-sft-layout.json) | MOSS-Image SFT layout prompting |

For the image-to-image example, use **Import** on its Canvas loader to load the
supplied [input image](anima-image-to-image-input.webp), or choose your own image.
The saved workflows retain their original image/history references; historical
editing assets are not included. Model files are not bundled.
