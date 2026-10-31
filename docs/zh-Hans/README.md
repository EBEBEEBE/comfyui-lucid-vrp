![LuCiD VRP](../images/header.webp)

[English](../../README.md) | **简体中文** | [繁體中文](../zh-Hant/README.md) | [日本語](../ja/README.md)

---

**LuCiD VRP**（Visual Regional Painter）是一套 ComfyUI 自定义节点，集图像加载、图层编辑、**Anima 区域提示词**和 **MOSS-Image 布局提示词**于一身。它主要为**图生图（img2img）工作流**设计，让你直接在 ComfyUI 中完成构图、图像编辑和提示词设置。

内置的轻量图像编辑器 **LuCiD Canvas** 既可以导入现有图像，也可以从空白画布开始。图层组合、绘画、变换、扭曲和可还原的裁剪，都能直接在 ComfyUI 中完成。

想要控制画面中的不同区域，可以使用 **Anima 区域提示词**或 **MOSS-Image 可视化布局**工具。在画布上绘制边界框、拖动位置或调整大小，再为各个区域设置提示词。区域既可以集中在一个节点内管理，也可以拆分到独立的 **VRP Region** 节点中。修改后无需运行工作流，就能立即预览布局。

> [!NOTE]
> **模型支持**
>
> 图像加载节点和 LuCiD Canvas 不依赖 Anima 或 MOSS-Image，也可以搭配其他图像模型使用。不过，Latent 的兼容性仍取决于工作流和 VAE。
>
> **Anima** 支持按区域设置条件；**MOSS-Image** 的支持目前仍处于试验阶段，使用的是模型原生的 bbox（边界框）布局提示词。

先通过这个演示看看 LuCiD VRP 能做什么：

> [!TIP]
> ## LuCiD 演示：从布局到成图
> [![同步演示](../images/demos/regional-sync-preview.webp)](../images/demos/regional-sync.webp)
>
> | 1>> 布局 | 2>> 细化 | 3>> 构图 | 4>> 完成 |
> |---|---|---|---|
> | 使用 **MOSS VRP** 和 bbox 生成构图草案 | 将草案导入 **Anima VRP** 工作流 | 在 **LuCiD Canvas** 中重新摆放角色、调整构图 | 生成或重新生成图像 |

## 功能

- **为图生图设计的多功能图像加载节点**：既能从空白 Latent 开始，也能载入现有图像。画布尺寸调整、蒙版编辑、撤销与重做、Latent 编码，都能在同一个节点里完成，不用来回切换 ComfyUI 和外部编辑器。

  | 创建与调整尺寸 | 撤销与重做 | 编码与尺寸对齐 |
  |---|---|---|
  | [![分辨率选择演示](../images/demos/loader-resize-preview.webp)](../images/demos/loader-resize.webp) | [![撤销与重做演示](../images/demos/loader-undo-redo-preview.webp)](../images/demos/loader-undo-redo.webp) | [![内置 Latent 功能演示](../images/demos/loader-latent-preview.webp)](../images/demos/loader-latent.webp) |
  | 新建画布，或同时调整图像与蒙版的尺寸。可以选择预设、输入自定义尺寸，并查看宽高比。 | 图像、绘画和蒙版的修改都可以撤销或重做，方便保留编辑记录、尝试不同方案。 | 既能创建空 Latent，也能对载入的图像进行编码；同时支持分块 VAE 编码和自动尺寸对齐。 |

- **LuCiD Canvas：内置的轻量图像编辑器**：从快速搭建构图草案到细致调整图生图素材，都能在 ComfyUI 里完成。导入、组合图层，绘画或擦除，再用支持随时调整的对象变换、扭曲和可还原裁剪功能完善画面，最后直接将结果应用到图像加载节点。

  | 构图与图层 | 绘画与变换 | 控制与自定义 |
  |---|---|---|
  | [![图层演示](../images/demos/canvas-layers-preview.webp)](../images/demos/canvas-layers.webp) | [![扭曲演示](../images/demos/canvas-distort-preview.webp)](../images/demos/canvas-distort.webp) | [![取色演示](../images/demos/canvas-picker-preview.webp)](../images/demos/canvas-picker.webp) |
  | 用独立的图像对象与图层搭建构图。移动、排列和裁剪元素时可以保留原始内容，还能通过每张图像附带的绘画图层整理修改。 | 支持绘画、蒙版编辑、擦除和变换。调整位置或形状时，原始图像仍可保留。 | 画笔设置和取色工具随手可用，快捷键与鼠标操作也能按自己的习惯调整。 |

- **Anima 与 MOSS-Image 的可视化区域提示词工具**：直接在画面上安排区域位置，按需要组织节点，修改布局时随时预览效果。

  [![区域演示](../images/demos/regions-preview.webp)](../images/demos/regions.webp)

  | 绘制与组织 | 提示词与引导 | 编码与连接 |
  |---|---|---|
  | 在画布上绘制边界框，拖动位置或调整大小。可以在一个节点内管理所有区域，也可以使用独立的 **VRP Region** 节点，布局变化会立即显示。 | **Anima** 可以按区域设置边界框或蒙版、正向与负向提示词，还能调整影响强度和混合提示词。**MOSS-Image** 的边界框布局也能直接在画面上编辑，不必手写 JSON 或计算坐标。 | 内置编码功能的输出可以直接连接采样器。也可以用 **VRP Prompt Combine** 汇总外部 Region 节点的提示词，再交给独立的编码节点或图像细化分支。MOSS 还能导出模型原生格式的布局 JSON，供后续单独编码。 |

## 安装

### 前置要求

- **使用经典（classic）节点界面的 ComfyUI。** 测试环境为 ComfyUI 0.42.0 + 前端 1.57.1。**目前暂不支持 Nodes 2.0**。
- **Python 3.11 或更新版本。**
- **图生图 Latent 编码**：需要与生成模型兼容的 VAE。
- **Anima 区域提示词**：需要 Anima 系列模型以及兼容的文本编码器和 VAE。基础模型、基于基础模型的微调版本、2.9B 微调版本均已测试。如果 Anima 工作流已经能正常运行，就不需要另外准备这些模型。
- **MOSS-Image 布局提示词**：需要**原生支持 MOSS-Image 的 ComfyUI**、MOSS-Image 模型权重、兼容的 Qwen 3.5 文本编码器，以及 Flux.2 VAE。**尚未测试非官方的 MOSS-Image 工作流和自定义节点**。

> [!NOTE]
> **关于较早版本的 ComfyUI**
>
> Anima 区域提示词、图像加载节点和 LuCiD Canvas 在 ComfyUI 0.32.0 + 前端 1.48.7，以及 ComfyUI 0.37.0 + 前端 1.53.6 中测试通过。这些版本不具备 MOSS-Image 原生支持。使用 MOSS 生成工作流前请更新 ComfyUI。

图像加载节点和 LuCiD Canvas 不需要依赖 Anima 或 MOSS。只要 ComfyUI 本身能正常运行，就不用额外安装 Python 依赖。仅编辑图像、不做 Latent 编码时，也不需要加载模型或 VAE。

### 从 Comfy Registry 安装

打开 **ComfyUI Manager**，搜索 **LuCiD Visual Regional Painter**（`lucid-vrp`）并安装。随后重启 ComfyUI，刷新浏览器。

如果已经配置了 Comfy CLI，也可以运行：

```sh
comfy node install lucid-vrp
```

### 从源码安装

将仓库克隆到 ComfyUI 的 `custom_nodes` 目录。以 Windows PowerShell 为例：

```powershell
cd "C:\path\to\ComfyUI\custom_nodes"
git clone https://github.com/EBEBEEBE/comfyui-lucid-vrp.git
```

也可以下载仓库的 ZIP 压缩包，解压到 `ComfyUI/custom_nodes`。目录结构示例：

```text
ComfyUI/
└── custom_nodes/
    └── comfyui-lucid-vrp/
        ├── __init__.py
        ├── nodes.py
        ├── canvas.py
        ├── anima_regional.py
        ├── web/
        └── ...
```

> [!NOTE]
> - Windows 便携版的 `custom_nodes` 位于**内层 `ComfyUI` 文件夹**中。
> - 从 GitHub 下载 ZIP 时，文件夹名称可能有所不同（如 `comfyui-lucid-vrp-main`）。只要解压后 `__init__.py` 直接位于该文件夹下，文件夹名称就不会影响使用。

重启 ComfyUI 并刷新浏览器。在添加节点菜单的 **LuCiD VRP** 分类中查找这些节点。

## 快速开始

### 在图生图工作流中使用 VRP 图像加载节点

如果只想给现有工作流提供通用的 `IMAGE` 和 `MASK`，使用 **VRP Standalone Image Loader** 即可。如果还要用 Anima 区域提示词或 MOSS-Image 布局提示词，就选择 **VRP Canvas Image Loader** 来提供画布输入。

- 点击 **Import** 或将图像文件拖到图像加载节点上，载入现有图像或构图草案；也可以使用 **Create blank** 从空白画布开始。
- 点击 **Edit canvas** 打开 **LuCiD Canvas**。导入更多图像图层，绘制，并通过变换和排列画面元素来调整构图。
- 点击 **Apply** 将编辑结果应用到加载节点中。

`image` 和 `mask` 输出可以直接连接现有的 ComfyUI 工作流。只用图像和蒙版时，请把 Latent 模式设为 **Off**，不用连接 `latent` 输出。

如果模型和工作流兼容，还可以直接使用加载节点内置的 Latent 编码，省去单独的 VAE Encode 节点。

- 连接与目标模型兼容的 **VAE**，选择 **Encode**、**Encode (Tiled)** 或 **Auto**。Auto 会对导入的图像或已添加绘画内容的空白画布进行编码；对于未经编辑的白色空白画布，则直接输出 Empty Latent。
- 将图像加载器节点的 `latent` 输出连接到采样器的 `latent_image` 输入。
- 按用途调整 **denoise**：使用空 Latent，或只把导入图像作为构图参考时，设为 **1.0**；希望保留输入图像的影响时，设为**小于 1.0**的数值。

生成工作流的其余部分可以保持原样。

> [!NOTE]
> **Latent 兼容性**
>
> 图像加载节点的 `IMAGE` 和 `MASK` 输出不限定模型。内置 Latent 编码将使用接入的 VAE，并输出该 VAE 对应的 Latent 格式。
>
> **Empty** 使用 ComfyUI 标准的空图像 Latent 占位数据，兼容的原生采样器会根据所连接的模型调整格式。特殊流程或自定义采样器仍可能需要专用的 Latent 节点。画布宽高默认对齐到 **32** 的倍数。

详情请参阅[图像加载节点指南](../image-loaders.md)和 [LuCiD Canvas 手册](../canvas-tutorial.md)（目前为英文）。

### MOSS-Image SFT 布局提示词工作流

> [!TIP]
> 下面的图片内嵌了工作流。把图片原文件拖入 ComfyUI 就能载入示例，再选择已安装的模型即可。

先准备一个能正常运行的 MOSS-Image SFT 生成工作流，再添加 **VRP Canvas Image Loader** 和 **MOSS - Visual Regional Prompt** 节点。

将加载节点设为 **Empty**，创建空白画布。可以直接在 MOSS 节点里绘制边界框，也可以使用独立的 **VRP Region** 节点设置区域，再连接到 MOSS 节点的 `canvas` 和 `regions` 输入。各区域填写正向提示词，整个场景则用全局提示词描述。

连接与 MOSS 兼容的 CLIP，再把 MOSS 节点的 `positive` 和 `negative` 输出接到采样器，初始 Latent 则使用 Canvas 加载节点的 `latent`。

[![MOSS-Image SFT 布局提示词示例](../images/workflows/moss-sft-layout.webp)](../images/workflows/moss-sft-layout.webp)

详情请参阅 [MOSS 布局指南](../moss-layout.md)（英文）。

### Anima 区域提示词工作流

下文把 **Anima VRP** 的核心节点简称为 Core。

> [!IMPORTANT]
> Anima 的区域条件控制能引导构图，并让提示词尽量对应到指定区域。但它不能保证 100% 精确控制，某个区域的提示词也可能影响其他区域。
>
> 想更细致地控制初始构图，可以参考下面的图生图流程，配合 **VRP 图像加载节点**和 **LuCiD Canvas** 使用。局部重绘等后期处理仍需要独立的工作流。

> [!TIP]
> 下方图像均嵌入了工作流。将原始图像拖入 ComfyUI，即可载入对应示例。

#### 图生图 + Anima 区域提示词

点击 VRP Canvas Image Loader 的 **Import**，载入草图、构图草案或现有图像；也可以新建空白画布并绘制草案。

点击 **Edit canvas** 打开 **LuCiD Canvas**，搭建并调整构图。可以把其他图像导入为图层，移动和变换对象、用画笔补充细节，也可以在保留原始素材的前提下裁剪或扭曲元素。完成后点击 **Apply**，把结果应用到加载节点。

连接与 Anima 兼容的 VAE，将 Latent 模式保持为 **Auto**，或手动选 **Encode**。把加载节点的 `canvas` 和 `latent` 分别接到 Core 的 `canvas` 和 `latent_image`，再设置区域。将兼容 Anima 的 CLIP 接入 Core，然后把 Core 输出的已打补丁模型、conditioning（可选）和 Latent 连接到采样器。想保留初始图像的影响，请将 **denoise 设为小于 1.0**。

> [!TIP]
> MOSS-Image 拥有强大的构图和画面结构控制功能。可以先用 MOSS 生成构图草案，再将其作为 Anima 的图生图输入，发挥两者各自的优势。

[![Anima 图生图示例](../images/workflows/anima-image-to-image.webp)](../images/workflows/anima-image-to-image.webp)

此工作流的示例输入图像可在[这里](../images/workflows/anima-image-to-image-input-file.webp)找到。

关于图层编辑、绘画、变换、蒙版和自定义操作的更多说明，请参阅 [LuCiD Canvas 手册](../canvas-tutorial.md)（英文）。

#### 仅使用内部区域：极简配置

仅使用 **VRP Canvas Image Loader**、**Anima VRP** 核心节点，以及常规的 Anima 模型加载节点和采样器。

在 **Empty** 模式下创建空白画布，将加载节点的 `canvas` 和 `latent` 分别连接到 Core 的 `canvas` 和 `latent_image`。直接在 Core 中绘制边界框，选择区域后编辑名称、权重、正面和负面提示词。Core 会向采样器输出已应用区域补丁的模型、conditioning 和 Latent。

[![Anima 最小配置示例](../images/workflows/anima-minimal.webp)](../images/workflows/anima-minimal.webp)

#### 使用外部区域

为每个区域创建一个独立的 **VRP Region** 节点。你可以使用 bbox、利用原生 Mask Editor 绘制蒙版，或连接外部 `MASK` 输入来指定区域。

将 Region 节点串联到 Core，并在节点链中同时传递 **`canvas` 和 `regions`**。将前一个节点的 `regions` 输出连接到下一个节点的 `previous_regions` 输入，最后将末端节点的两路输出都连接到 Core。

外部区域也能和 Core 内绘制的边界框一起使用。

[![Anima 外部区域示例](../images/workflows/anima-external-regions.webp)](../images/workflows/anima-external-regions.webp)

## 文档与示例

以下详细指南目前为英文。

| 指南 | 内容 |
| --- | --- |
| [节点参考](../nodes.md) | 节点选择、连接方式和输出 |
| [图像加载节点](../image-loaders.md) | 导入、绘画、调整尺寸、撤销/重做、Latent 模式与尺寸对齐 |
| [LuCiD Canvas 手册](../canvas-tutorial.md) | 图层、绘画、变换、扭曲、可还原的裁剪和蒙版 |
| [Canvas 速查](../canvas-reference.md) | 编辑器操作、快捷键、偏好设置和已保存的编辑状态 |
| [MOSS 布局提示词](../moss-layout.md) | 内部/外部边界框、场景提示词、编码与 MOSS 转换限制 |
| [区域与提示词](../regions.md) | 内部边界框、外部 Region 节点链、蒙版与 Prompt Mix |
| [高级设置](../advanced-settings.md) | 区域路由预设、控制选项与性能取舍 |
| [配置](../configuration.md) | 自定义分辨率预设、颜色、界面布局与初始区域 |
| [故障排查](../troubleshooting.md) | 常见错误与检查方法 |
| [兼容性与限制](../limitations.md) | 已支持的环境与当前功能边界 |

## 已知限制

- **仅支持 ComfyUI 的经典（classic）节点界面。** 目前不支持 Nodes 2.0。
- **区域引导不能精确锁定生成结果。** Anima 区域和 MOSS-Image 布局边界框可以帮助控制构图，但不能100%保证元素出现在准确的位置。不同区域的特征也可能相互影响，指定的像素不一定会原样保留。
- **MOSS-Image 支持仍处于实验阶段。** 输入蒙版会转换为 bbox。不支持各区域单独设置负向提示词，区域权重也只能使用整数；负向提示词仅对全局生效。
- **当前版本暂不包含**蒙版局部重绘（inpainting）、区域 LoRA 和内置 ControlNet 集成。如有需要，请使用其他节点或工作流。
- **Anima 注意力补丁可能与其他扩展冲突**，尤其是修改相同注意力操作的扩展。
- **工作流文件保存时并不会同时保存所有图像编辑素材。** 请保留工作流引用的图像、蒙版和 Canvas 图层素材，方便之后重新打开编辑内容和历史记录。

更多说明请参阅[兼容性与限制](../limitations.md)（英文）。

## 致谢

- [Sen-sou 的 ComfyUI-Anima-Regional-Conditioning](https://github.com/Sen-sou/Comfyui-Anima-Regional-Conditioning)：VRP 的 Anima 区域条件控制逻辑基于此实现改编。
- [OpenMOSS / MOSS-Image](https://github.com/OpenMOSS/MOSS-Image)：VRP 的 MOSS 集成所使用的模型和原生布局提示词格式文档。
- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) 与 [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)：提供宿主 API、经典（classic）节点界面、原生文本/VAE 编码和采样、Clipspace，以及 Region 蒙版所使用的原生 Mask Editor。
- 开发参考：[sd-forge-couple](https://github.com/Haoming02/sd-forge-couple)（边界框交互）、[Anima-Artist-Mixer](https://github.com/An1X3R/Anima-Artist-Mixer)（模型包装器行为），以及 [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)（前端生命周期与事件模式）。
- 开发时研究了 [ComfyUI Prompt Control](https://github.com/asagi4/comfyui-prompt-control) 的行为与 API，以及 [Regional-Prompting-FLUX](https://github.com/instantX-research/Regional-Prompting-FLUX) 的设计思路。VRP 没有复制或复用 Prompt Control 的实现代码。

关于改编代码、宿主集成和开发参考的详细说明，请查看[第三方声明](../../THIRD_PARTY_NOTICES.md)。

## 许可证

LuCiD VRP 自行开发的软件和编写的文档正文（包括 **LuCiD Canvas** 和 **MOSS 布局节点**）均采用 [MIT 许可证](../../LICENSE)。改编的第三方代码仍受各自的版权和许可证条款约束，详见[第三方声明](../../THIRD_PARTY_NOTICES.md)。

模型、文本编码器和单独安装的宿主项目仍适用各自的条款。
