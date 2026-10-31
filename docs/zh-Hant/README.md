![LuCiD VRP](../images/header.webp)

[English](../../README.md) | [简体中文](../zh-Hans/README.md) | **繁體中文** | [日本語](../ja/README.md)

> [!NOTE]
> 本文檔由 AI 自動翻譯生成，部分用語可能不夠自然，也可能存在翻譯錯誤。如有看不懂或與原文不一致的地方，請參考[英文版](../../README.md)。也歡迎協助修正翻譯！

---

**LuCiD VRP**（Visual Regional Painter）是一套 ComfyUI 自訂節點，整合了圖像載入、圖層編輯、**Anima 區域提示詞**與 **MOSS-Image 畫面配置提示詞**。它主要針對**圖生圖（img2img）工作流程**設計，讓你直接在 ComfyUI 裡完成構圖、圖像編輯與提示詞設定。

內建的輕量圖像編輯器 **LuCiD Canvas** 可以載入現有圖像，也能從空白畫布開始。圖層合成、繪畫、變形、扭曲和可還原的裁切，都能直接在 ComfyUI 裡完成。

需要安排不同區域的生成內容時，可以使用 **Anima 區域提示詞**或 **MOSS-Image 視覺化畫面配置**工具。直接在畫布上畫出邊界框、移動位置、調整大小，再為各個區域設定提示詞。區域可以集中在同一個節點管理，也能拆分成獨立的 **VRP Region** 節點。修改後不用執行工作流程，就能立即預覽配置。

> [!NOTE]
> **模型支援**
>
> 圖像載入節點與 LuCiD Canvas 不依賴 Anima 或 MOSS-Image，也能搭配其他圖像模型使用。不過，Latent（潛在空間表示）是否相容，仍取決於工作流程與 VAE。
>
> **Anima** 支援依區域設定條件；**MOSS-Image** 的支援目前仍在實驗階段，採用模型原生的邊界框畫面配置提示詞。

先透過這段示範看看 LuCiD VRP 能做什麼：

> [!TIP]
> ## LuCiD 示範：從畫面配置到成圖
> [![同步操作示範](../images/demos/regional-sync-preview.webp)](../images/demos/regional-sync.webp)
>
> | 1>> 配置 | 2>> 細化 | 3>> 構圖 | 4>> 完成 |
> |---|---|---|---|
> | 使用 **MOSS VRP** 與邊界框生成構圖草案 | 將草案匯入 **Anima VRP** 工作流程 | 在 **LuCiD Canvas** 中重新擺放角色、調整構圖 | 生成或重新生成圖像 |

## 功能

- **專為圖生圖設計的多功能圖像載入節點**：可以從空 Latent 開始，也可以載入現有圖像。調整畫布大小、編輯遮罩、復原與重做，以及 Latent 編碼，都能在同一個節點完成，不必一直切換 ComfyUI 和外部編輯器。

  | 建立與調整尺寸 | 復原與重做 | 編碼與尺寸對齊 |
  |---|---|---|
  | [![解析度選擇示範](../images/demos/loader-resize-preview.webp)](../images/demos/loader-resize.webp) | [![復原與重做示範](../images/demos/loader-undo-redo-preview.webp)](../images/demos/loader-undo-redo.webp) | [![內建 Latent 功能示範](../images/demos/loader-latent-preview.webp)](../images/demos/loader-latent.webp) |
  | 建立新畫布，或一起調整圖像與遮罩的尺寸。可以選擇預設或自行輸入大小，並查看長寬比。 | 圖像、繪畫與遮罩的修改都能復原或重做，保留編輯記錄的同時，也方便嘗試不同的構圖。 | 可以建立空 Latent，也能將載入的圖像編碼為 Latent，並支援分塊 VAE 編碼及自動尺寸對齊。 |

- **LuCiD Canvas：內建的輕量圖像編輯器**：不管是快速畫出構圖草案，還是仔細調整圖生圖素材，都能直接在 ComfyUI 裡處理。匯入、組合圖層，繪畫或擦除，再透過可繼續調整的變形、扭曲和可還原裁切完成構圖，最後直接套用到圖像載入節點。

  | 構圖與圖層 | 繪畫與變形 | 控制與自訂 |
  |---|---|---|
  | [![圖層示範](../images/demos/canvas-layers-preview.webp)](../images/demos/canvas-layers.webp) | [![扭曲示範](../images/demos/canvas-distort-preview.webp)](../images/demos/canvas-distort.webp) | [![取色示範](../images/demos/canvas-picker-preview.webp)](../images/demos/canvas-picker.webp) |
  | 透過獨立的圖像物件與圖層安排構圖。移動、排列、裁切元素時可以保留原始內容，並用各張圖像附帶的繪畫圖層整理修改。 | 支援繪畫、遮罩編輯、擦除與變形。可以快速調整元素的位置或形狀，同時保留原始圖像。 | 筆刷設定與取色工具都能隨手使用，也可以依自己的習慣調整快捷鍵和滑鼠操作。 |

- **Anima 與 MOSS-Image 的視覺化區域提示詞工具**：直接在畫面上安排區域位置，依需要組合節點，調整時也能即時查看配置。

  [![區域操作示範](../images/demos/regions-preview.webp)](../images/demos/regions.webp)

  | 繪製與管理 | 提示詞與引導 | 編碼與連接 |
  |---|---|---|
  | 直接在畫布上畫出邊界框，移動位置或調整大小。區域可以集中在同一個節點，也可以使用獨立的 **VRP Region** 節點，變更後立即就能預覽。 | **Anima** 可以設定邊界框或遮罩，以及各區域的正向、負向提示詞，再透過影響強度與提示詞混合來引導生成。**MOSS-Image** 的邊界框配置也可以直接在畫面上編輯，不必手寫 JSON 或計算座標。 | 內建編碼功能的輸出可以直接連接採樣器。也可以透過 **VRP Prompt Combine** 彙整外部 Region 節點的提示詞，再交給獨立的編碼節點或圖像細化分支處理。MOSS 還能匯出模型原生格式的畫面配置 JSON，方便另外編碼。 |

## 安裝

### 環境需求

- **使用傳統（classic）節點介面的 ComfyUI。** 測試環境為 ComfyUI 0.42.0 + 前端 1.57.1。**目前尚不支援 Nodes 2.0**。
- **Python 3.11 或更新版本。**
- **圖生圖 Latent 編碼**：需要與生成模型相容的 VAE。
- **Anima 區域提示詞**：需要 Anima 系列模型，以及相容的文字編碼器與 VAE。基礎模型、基礎模型的微調版本和 2.9B 微調版本都已測試。如果 Anima 工作流程本來就能正常執行，就不需要另外準備這些模型。
- **MOSS-Image 畫面配置提示詞**：需要**原生支援 MOSS-Image 的 ComfyUI**、MOSS-Image 模型權重、相容的 Qwen 3.5 文字編碼器，以及 Flux.2 VAE。**尚未測試非官方的 MOSS-Image 工作流程與自訂節點**。

> [!NOTE]
> **較早版本的 ComfyUI**
>
> Anima 區域提示詞、圖像載入節點與 LuCiD Canvas 也曾在 ComfyUI 0.32.0 + 前端 1.48.7，以及 ComfyUI 0.37.0 + 前端 1.53.6 中測試。這些版本沒有 MOSS-Image 原生支援；使用 MOSS 生成工作流程前，請先更新 ComfyUI。

圖像載入節點與 LuCiD Canvas 不需要依賴 Anima 或 MOSS。只要 ComfyUI 本身能正常執行，就不必另外安裝 Python 套件。只編輯圖像、不進行 Latent 編碼時，也不需要模型或 VAE。

### 從 Comfy Registry 安裝

開啟 **ComfyUI Manager**，搜尋 **LuCiD Visual Regional Painter**（`lucid-vrp`）並安裝。接著重新啟動 ComfyUI，重新整理瀏覽器。

如果已經設定好 Comfy CLI，也可以執行：

```sh
comfy node install lucid-vrp
```

### 從原始碼安裝

將儲存庫複製（clone）到 ComfyUI 的 `custom_nodes` 目錄。例如，在 Windows PowerShell 中：

```powershell
cd "C:\path\to\ComfyUI\custom_nodes"
git clone https://github.com/EBEBEEBE/comfyui-lucid-vrp.git
```

也可以下載儲存庫的 ZIP 壓縮檔，解壓縮至 `ComfyUI/custom_nodes`。資料夾結構範例：

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
> - Windows 可攜版的 `custom_nodes` 位於**內層的 `ComfyUI` 資料夾**中。
> - 從 GitHub 下載 ZIP 後，儲存庫資料夾可能名為 `comfyui-lucid-vrp-main`。只要 `__init__.py` 直接位於該資料夾內，資料夾名稱就不影響使用。

重新啟動 ComfyUI 並重新整理瀏覽器。在新增節點選單的 **LuCiD VRP** 分類中尋找這些節點。

## 快速入門

### 在圖生圖工作流程中使用 VRP 圖像載入節點

如果只需要把 `IMAGE` 和 `MASK` 傳給現有工作流程，使用 **VRP Standalone Image Loader** 就夠了。如果要搭配 Anima 區域提示詞或 MOSS-Image 畫面配置提示詞，則使用 **VRP Canvas Image Loader** 提供畫布輸入。

- 按下 **Import** 或將圖像檔案拖曳到載入節點上，載入現有圖像或構圖草案；也可以使用 **Create blank** 從空白畫布開始。
- 按下 **Edit canvas** 開啟 **LuCiD Canvas**。匯入更多圖像圖層，繪畫，並透過變形與排列畫面元素來調整構圖。
- 按下 **Apply**，將編輯結果套用至載入節點。

`image` 與 `mask` 輸出可以直接接到現有的 ComfyUI 工作流程。如果只需要圖像和遮罩，將 Latent 模式設為 **Off**，不用連接 `latent` 輸出。

如果模型與工作流程相容，也可以直接使用載入節點的 Latent 編碼功能，省去額外的 VAE Encode 節點。

- 連接相容的 **VAE**，選擇 **Encode**、**Encode (Tiled)** 或 **Auto**。Auto 會將匯入的圖像，以及已加入 RGB 繪畫內容的空白畫布編碼為 Latent；如果白色空白畫布還沒有任何繪畫內容，則使用 Empty。
- 將載入節點的 `latent` 輸出連接到採樣器的 `latent_image` 輸入。
- **denoise** 請依用途調整：使用空 Latent，或只把匯入的圖像當作構圖參考時，設為 **1.0**；希望保留輸入圖像的影響時，設為**小於 1.0**。

生成工作流程的其餘部分維持原樣。

> [!NOTE]
> **Latent 相容性**
>
> 圖像載入節點的 `IMAGE` 與 `MASK` 輸出不限於特定模型。內建 Latent 編碼使用連接的 VAE，並輸出該 VAE 對應的 Latent 格式。
>
> **Empty** 使用 ComfyUI 標準的空圖像 Latent 佔位資料，並由相容的原生採樣器依連接的模型調整格式。特殊流程或自訂採樣器仍可能需要專用 Latent 節點。畫布的寬高預設對齊至 **32** 的倍數。

詳情請參閱[圖像載入節點指南](../image-loaders.md)與 [LuCiD Canvas 手冊](../canvas-tutorial.md)（目前為英文）。

### MOSS-Image SFT 畫面配置提示詞工作流程

> [!TIP]
> 下方圖片內嵌了工作流程。把圖片原始檔拖進 ComfyUI 就能載入範例，接著選擇已安裝的模型即可。

先準備一個能正常執行的 MOSS-Image SFT 生成工作流程，再加入 **VRP Canvas Image Loader** 與 **MOSS - Visual Regional Prompt** 節點。

以 **Empty** 模式建立空白畫布。可以直接在 MOSS 節點內畫出邊界框，也可以用獨立的 **VRP Region** 節點設定區域，再連接至 MOSS 節點的 `canvas` 與 `regions` 輸入。各區域設定正向提示詞，整體場景則用全域提示詞描述。

連接與 MOSS 相容的 CLIP，將 MOSS 節點的 `positive` 與 `negative` 輸出接到採樣器，並使用 Canvas 載入節點的 `latent` 作為初始 Latent。

[![MOSS-Image SFT 畫面配置提示詞範例](../images/workflows/moss-sft-layout.webp)](../images/workflows/moss-sft-layout.webp)

詳情請參閱 [MOSS 畫面配置指南](../moss-layout.md)（英文）。

### Anima 區域提示詞工作流程

以下將 **Anima VRP** 的核心節點簡稱為 Core。

> [!IMPORTANT]
> Anima 的區域條件控制可以引導構圖，讓提示詞對應到指定區域。但它無法保證元素出現在精確位置，提示詞也可能影響到其他區域。
>
> 想更細緻地控制初始構圖，可以參考下面的圖生圖流程，搭配 **VRP 圖像載入節點**與 **LuCiD Canvas**。局部重繪等後製處理仍需另外的工作流程。

> [!TIP]
> 下方圖像均內嵌了工作流程。將原始圖像拖曳到 ComfyUI，即可載入對應範例。

#### 圖生圖 + Anima 區域提示詞

按下 VRP Canvas Image Loader 的 **Import**，載入草圖、構圖草案或現有圖像；也可以新建空白畫布並繪製草案。

按下 **Edit canvas** 開啟 **LuCiD Canvas**，開始安排構圖。你可以把其他圖像匯入成圖層，移動、變形物件，用筆刷補上細節，也能在保留原始內容的情況下裁切或扭曲元素。完成後按下 **Apply**，將結果套用到載入節點。

連接相容的 VAE，讓 Latent 模式維持 **Auto**，或手動選擇 **Encode**。將載入節點的 `canvas` 與 `latent` 分別連接到 Core 的 `canvas` 和 `latent_image`，接著定義區域。為 Core 連接與 Anima 相容的 CLIP，再將 Core 輸出的模型（已套用補丁）、條件資訊（選用）與 Latent 接到採樣器。將 **denoise 設為小於 1.0**，以保留初始圖像的影響。

> [!TIP]
> MOSS-Image 很適合安排整體構圖。可以先用 MOSS 生成草案，再交給 Anima 進行圖生圖，結合兩者的優點。

[![Anima 圖生圖範例](../images/workflows/anima-image-to-image.webp)](../images/workflows/anima-image-to-image.webp)

此工作流程的範例輸入圖像可在[這裡](../images/workflows/anima-image-to-image-input-file.webp)取得。

關於圖層編輯、繪畫、變形、遮罩與自訂操作的更多說明，請參閱 [LuCiD Canvas 手冊](../canvas-tutorial.md)（英文）。

#### 僅使用內部區域：最精簡的配置

只需要 **VRP Canvas Image Loader**、**Anima VRP** 核心節點，以及一般的 Anima 模型載入節點與採樣器。

在 **Empty** 模式下建立空白畫布，將載入節點的 `canvas` 與 `latent` 分別連接到 Core 的 `canvas` 和 `latent_image`。直接在 Core 中繪製邊界框，選取區域後編輯名稱、權重、正向與負向提示詞。Core 為採樣器提供模型（已套用補丁）、條件資訊與 Latent。

[![Anima 精簡配置範例](../images/workflows/anima-minimal.webp)](../images/workflows/anima-minimal.webp)

#### 使用外部區域

為每個區域建立獨立的 **VRP Region** 節點。你可以用邊界框指定區域，也可以使用原生 Mask Editor 繪製的遮罩，或連接外部 `MASK` 輸入。

將 Region 節點串接到 Core，並在節點鏈中同時傳遞 **`canvas` 與 `regions`**。將前一個節點的 `regions` 輸出連接到下一個節點的 `previous_regions` 輸入，最後將末端節點的兩路輸出都連接到 Core。

外部區域也能和 Core 內畫出的邊界框一起使用。

[![Anima 外部區域範例](../images/workflows/anima-external-regions.webp)](../images/workflows/anima-external-regions.webp)

## 文件與範例

以下詳細指南目前為英文。

| 指南 | 內容 |
| --- | --- |
| [節點參考](../nodes.md) | 節點選擇、連接方式與輸出 |
| [圖像載入節點](../image-loaders.md) | 匯入、繪畫、調整尺寸、復原/重做、Latent 模式與尺寸對齊 |
| [LuCiD Canvas 手冊](../canvas-tutorial.md) | 圖層、繪畫、變形、扭曲、可還原的裁切與遮罩 |
| [Canvas 速查](../canvas-reference.md) | 編輯器操作、快捷鍵、偏好設定與已儲存的編輯狀態 |
| [MOSS 畫面配置提示詞](../moss-layout.md) | 內部/外部邊界框、場景提示詞、編碼與 MOSS 轉換限制 |
| [區域與提示詞](../regions.md) | 內部邊界框、外部 Region 節點鏈、遮罩與 Prompt Mix |
| [進階設定](../advanced-settings.md) | 區域路由預設、控制選項與效能取捨 |
| [設定檔](../configuration.md) | 自訂解析度預設、顏色、介面配置與初始區域 |
| [疑難排解](../troubleshooting.md) | 常見錯誤與檢查方法 |
| [相容性與限制](../limitations.md) | 已支援的環境與目前功能範圍 |

## 已知限制

- **僅支援 ComfyUI 的傳統（classic）節點介面。** 目前不支援 Nodes 2.0。
- **區域引導無法完全鎖定生成結果。** Anima 的區域設定和 MOSS-Image 的畫面配置邊界框能協助安排構圖，但不能保證元素出現在精確位置。不同區域的特徵也可能互相影響，指定像素不一定會原樣保留。
- **MOSS-Image 支援仍在實驗階段。** 輸入遮罩會轉換為外接矩形。不支援各區域獨立的負向提示詞，區域權重也只能使用整數；負向提示詞會套用至全域。
- **目前的版本尚未內建**遮罩局部重繪、區域 LoRA 與 ControlNet 整合。如有需要，請使用其他節點或工作流程。
- **Anima 注意力補丁可能與其他擴充功能衝突**，尤其是修改相同注意力運算的擴充功能。
- **只儲存工作流程檔案，並不會一併保存所有圖像編輯素材。** 請另外保留工作流程參照的圖像、遮罩與 Canvas 圖層素材，才能在之後重新開啟編輯內容與歷程記錄。

更多說明請參閱[相容性與限制](../limitations.md)（英文）。

## 致謝

- [Sen-sou 的 ComfyUI-Anima-Regional-Conditioning](https://github.com/Sen-sou/Comfyui-Anima-Regional-Conditioning)：VRP 的 Anima 區域條件控制邏輯以此為基礎改編。
- [OpenMOSS / MOSS-Image](https://github.com/OpenMOSS/MOSS-Image)：VRP 的 MOSS 整合所使用的模型與原生畫面配置提示詞格式文件。
- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) 與 [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)：提供宿主 API、傳統（classic）節點介面、原生文字/VAE 編碼與採樣、Clipspace，以及 Region 遮罩所使用的原生 Mask Editor。
- 開發參考：[sd-forge-couple](https://github.com/Haoming02/sd-forge-couple)（邊界框互動）、[Anima-Artist-Mixer](https://github.com/An1X3R/Anima-Artist-Mixer)（模型包裝器行為），以及 [ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)（前端生命週期與事件模式）。
- 開發時研究了 [ComfyUI Prompt Control](https://github.com/asagi4/comfyui-prompt-control) 的行為與 API，以及 [Regional-Prompting-FLUX](https://github.com/instantX-research/Regional-Prompting-FLUX) 的設計思路。VRP 並未複製或沿用 Prompt Control 的實作程式碼。

關於改編程式碼、宿主整合和開發參考的詳細說明，請參閱[第三方聲明](../../THIRD_PARTY_NOTICES.md)。

## 授權條款

LuCiD VRP 自行開發的軟體與撰寫的文件正文（包括 **LuCiD Canvas** 與 **MOSS 畫面配置節點**）皆採用 [MIT 授權條款](../../LICENSE)。改編的第三方程式碼仍適用各自的著作權與授權條款，詳見[第三方聲明](../../THIRD_PARTY_NOTICES.md)。

模型、文字編碼器與另行安裝的宿主專案仍適用各自的條款。
