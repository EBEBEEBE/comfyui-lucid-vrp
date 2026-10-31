![LuCiD VRP](../images/header.webp)

[English](../../README.md) | [简体中文](../zh-Hans/README.md) | [繁體中文](../zh-Hant/README.md) | **日本語**

> [!NOTE]
> このページはAIを使って翻訳しています。日本語に不自然なところや誤訳が残っているかもしれません。分かりにくい箇所があれば、[英語版](../../README.md)もご確認ください。翻訳の修正や改善案も大歓迎です。

---

**LuCiD VRP**（Visual Regional Painter）は、画像の読み込みやレイヤー編集、**Anima の領域プロンプト**、**MOSS-Image のレイアウトプロンプト**を ComfyUI で使えるようにするノードセットです。**img2img**（画像から画像を生成するワークフロー）を中心に設計しており、構図作りから画像編集、プロンプトの設定まで、画面を見ながらスムーズに進められます。

内蔵の軽量エディター **LuCiD Canvas** では、画像を読み込むことも、空白のキャンバスから始めることもできます。ComfyUI を開いたまま、レイヤーの合成や描画、変形、歪み変形、元に戻せるトリミングまで行えます。

**Anima の領域プロンプト**と **MOSS-Image の視覚的なレイアウト指定**にも対応。キャンバス上にボックスを描いて位置や大きさを調整し、領域ごとにプロンプトを設定できます。一つのノードにまとめても、個別の **VRP Region** ノードに分けても構いません。編集内容はワークフローを実行しなくてもすぐにプレビューできます。

> [!NOTE]
> **対応モデル**
>
> 画像ローダーと LuCiD Canvas は、Anima や MOSS-Image 以外のモデルでも単独で使えます。ただし、Latent（潜在表現）の互換性はワークフローと VAE によって異なります。
>
> **Anima** では領域ごとの条件付けが使えます。**MOSS-Image** への対応はまだ実験段階で、モデル標準のボックス形式でレイアウトを指定します。

まずは、どんなことができるのかデモをご覧ください。

> [!TIP]
> ## LuCiD デモ：レイアウトから完成画像まで
> [![連携デモ](../images/demos/regional-sync-preview.webp)](../images/demos/regional-sync.webp)
>
> | 1>> レイアウト | 2>> 調整 | 3>> 構図 | 4>> 仕上げ |
> |---|---|---|---|
> | **MOSS VRP** のボックス指定で構図案を生成 | **Anima VRP** のワークフローに取り込む | **LuCiD Canvas** でキャラクターを配置し直し、構図を調整 | 画像を生成・再生成 |

## 機能

- **img2img に便利な多機能画像ローダー**：空の Latent から始めることも、既存画像を読み込むこともできます。キャンバスのサイズ変更、マスク編集、取り消し・やり直し、Latent のエンコードまで、一つのノードで完結。ComfyUI と外部エディターを行き来する必要がありません。

  | 作成とサイズ変更 | 元に戻す・やり直す | エンコードと寸法の調整 |
  |---|---|---|
  | [![解像度選択デモ](../images/demos/loader-resize-preview.webp)](../images/demos/loader-resize.webp) | [![履歴操作デモ](../images/demos/loader-undo-redo-preview.webp)](../images/demos/loader-undo-redo.webp) | [![内蔵 Latent 機能のデモ](../images/demos/loader-latent-preview.webp)](../images/demos/loader-latent.webp) |
  | 新しいキャンバスを作ったり、画像とマスクをまとめてリサイズしたりできます。サイズはプリセットから選ぶか直接入力でき、縦横比も確認できます。 | 画像・描画・マスクの編集履歴を戻したり進めたりできるので、編集内容を残しながら別の案も試せます。 | 空の Latent を作ることも、読み込んだ画像をエンコードすることもできます。タイル方式の VAE エンコードと、寸法を所定の倍数にそろえる自動調整にも対応しています。 |

- **LuCiD Canvas：ComfyUI 内で使える軽量画像エディター**：ラフな構図作りから img2img 用の細かな調整まで対応します。レイヤーを読み込んで組み合わせ、描画や消去、後から調整できる変形・歪み変形、元に戻せるトリミングで構図を整えたら、そのまま画像ローダーに反映できます。

  | 構図とレイヤー | 描画と変形 | 操作とカスタマイズ |
  |---|---|---|
  | [![レイヤーデモ](../images/demos/canvas-layers-preview.webp)](../images/demos/canvas-layers.webp) | [![歪み変形デモ](../images/demos/canvas-distort-preview.webp)](../images/demos/canvas-distort.webp) | [![色の取得デモ](../images/demos/canvas-picker-preview.webp)](../images/demos/canvas-picker.webp) |
  | 画像オブジェクトやレイヤーを組み合わせて構図を作れます。元画像を残したまま移動・配置・トリミングでき、各画像に付く描画レイヤーで編集内容を整理できます。 | 描画やマスク編集、消去、変形もできます。元画像を残したまま、気になる部分を手早く調整できます。 | ブラシの調整やスポイトでの色の取得も手軽に行えます。ショートカットやマウス操作は、使いやすいように変更できます。 |

- **Anima と MOSS-Image の領域指定を視覚的に編集**：画面上で領域を配置しながら、ノードの分け方も自由に選べます。レイアウトの変更はその場でプレビューできます。

  [![領域編集デモ](../images/demos/regions-preview.webp)](../images/demos/regions.webp)

  | 描画と整理 | プロンプトと誘導 | エンコードと接続 |
  |---|---|---|
  | キャンバス上でボックスを描き、ドラッグして移動・サイズ変更できます。領域は一つのノードでも、個別の **VRP Region** ノードでも管理でき、変更はすぐにプレビューされます。 | **Anima** では、ボックスやマスク、領域ごとのポジティブ・ネガティブプロンプトを設定できます。影響度の調整やプロンプトの混合も可能です。**MOSS-Image** のボックス形式のレイアウトも、JSON の手書きや座標計算なしで作れます。 | 内蔵エンコードの出力はサンプラーに直接接続できます。**VRP Prompt Combine** を使えば、外部 Region ノードのプロンプトをまとめ、別のエンコード処理やリファイナー用の分岐へ渡すことも可能です。MOSS 用には、別途エンコードできるようモデル標準形式のレイアウト JSON も出力できます。 |

## インストール

### 必要な環境

- **従来のノード表示（classic）を使う ComfyUI。** テスト環境は ComfyUI 0.42.0 + フロントエンド 1.57.1 です。**現在、Nodes 2.0 には対応していません**。
- **Python 3.11 以降。**
- **img2img の Latent エンコード**には、生成モデルに対応した VAE が必要です。
- **Anima の領域プロンプト**には、Anima 系モデルと対応するテキストエンコーダー・VAE が必要です。ベースモデル、そのファインチューニング版、2.9B のファインチューニング版でテスト済みです。Anima をすでに動かせているなら、必要なモデルはそろっています。
- **MOSS-Image のレイアウトプロンプト**には、**MOSS-Image にネイティブ対応した ComfyUI**、MOSS-Image のモデル、対応する Qwen 3.5 テキストエンコーダー、Flux.2 VAE が必要です。**非公式の MOSS-Image ワークフローやカスタムノードはテストしていません**。

> [!NOTE]
> **旧バージョンの ComfyUI について**
>
> Anima の領域プロンプト、画像ローダー、LuCiD Canvas は、ComfyUI 0.32.0 + フロントエンド 1.48.7 と ComfyUI 0.37.0 + フロントエンド 1.53.6 でもテスト済みです。ただし、これらのバージョンは MOSS-Image にネイティブ対応していません。MOSS の生成ワークフローを使う場合は ComfyUI を更新してください。

画像ローダーと LuCiD Canvas だけなら、Anima や MOSS がなくても使えます。ComfyUI が動いていれば、追加の Python パッケージも不要です。Latent をエンコードせずに画像を編集するだけなら、モデルも VAE も必要ありません。

### Comfy Registry からインストール

**ComfyUI Manager** を開き、**LuCiD Visual Regional Painter**（`lucid-vrp`）を検索してインストールします。その後 ComfyUI を再起動し、ブラウザーを再読み込みしてください。

Comfy CLI を設定済みなら、次のコマンドでもインストールできます。

```sh
comfy node install lucid-vrp
```

### ソースからインストール

ComfyUI の `custom_nodes` ディレクトリにリポジトリをクローンします。Windows PowerShell での例：

```powershell
cd "C:\path\to\ComfyUI\custom_nodes"
git clone https://github.com/EBEBEEBE/comfyui-lucid-vrp.git
```

GitHub から ZIP をダウンロードして、`ComfyUI/custom_nodes` に展開しても構いません。フォルダー構成の例：

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
> - Windows ポータブル版では、`custom_nodes` は**ポータブル版のフォルダー内にある `ComfyUI` フォルダー**にあります。
> - GitHub から ZIP をダウンロードした場合、リポジトリのフォルダー名が `comfyui-lucid-vrp-main` になることがあります。その直下に `__init__.py` があれば、フォルダー名は任意です。

ComfyUI を再起動してブラウザーを再読み込みします。ノード追加メニューの **LuCiD VRP** カテゴリーから各ノードを追加できます。

## クイックスタート

### img2img ワークフローで VRP の画像ローダーを使う

`IMAGE` と `MASK` を既存のワークフローに渡すだけなら、**VRP Standalone Image Loader** で十分です。Anima の領域プロンプトや MOSS-Image のレイアウト指定にキャンバスも使うなら、**VRP Canvas Image Loader** を選びます。

- **Import** を押すか、画像ファイルをローダーにドラッグして、既存の画像や構図案を読み込みます。**Create blank** で空白のキャンバスから始めることもできます。
- **Edit canvas** で **LuCiD Canvas** を開きます。画像レイヤーを追加し、描画、変形、配置を行います。
- **Apply** を押して編集結果をローダーに反映します。

`image` と `mask` の出力は、そのまま既存の ComfyUI ワークフローで使用できます。画像・マスクのみを使う場合は、Latent モードを **Off** にし、`latent` は接続しません。

モデルとワークフローが対応していれば、ローダー内で Latent をエンコードできるため、別の VAE Encode ノードを置く必要はありません。

- 対応する **VAE** を接続し、**Encode**、**Encode (Tiled)**、または **Auto** を選びます。Auto は、読み込んだ画像や、RGB の描画内容を追加した空白キャンバスをエンコードします。何も描いていない白いキャンバスには Empty を使用します。
- ローダーの `latent` 出力を、サンプラーの `latent_image` 入力に接続します。
- **denoise** は用途に合わせて調整します。空の Latent を使う場合や、読み込んだ画像を構図の参考にするだけなら **1.0**。入力画像の見た目を生成結果に残したい場合は **1.0 未満**に設定します。

ほかの生成ワークフローの設定は、そのままで構いません。

> [!NOTE]
> **Latent の互換性**
>
> 画像ローダーの `IMAGE` と `MASK` 出力は、特定のモデルに依存しません。内蔵 Latent エンコードは接続された VAE を使い、その VAE に対応した形式の Latent を出力します。
>
> **Empty** では、空の画像に相当する ComfyUI 標準の仮の Latent データを使います。対応するネイティブサンプラーが、接続したモデルに合わせて形式を調整します。特殊なパイプラインやカスタムサンプラーでは、専用の Latent ノードが必要になる場合があります。キャンバスの幅と高さは、初期設定で **32** の倍数にそろえられます。

詳しくは[画像ローダーガイド](../image-loaders.md)と [LuCiD Canvas マニュアル](../canvas-tutorial.md)をご覧ください。詳細ガイドは現在英語のみです。

### MOSS-Image SFT のレイアウトプロンプト用ワークフロー

> [!TIP]
> 下の画像にはワークフローが埋め込まれています。画像の元ファイルを ComfyUI にドラッグすればサンプルを読み込めます。あとはインストール済みのモデルを選んでください。

まず、動作確認済みの MOSS-Image SFT 生成ワークフローを用意し、**VRP Canvas Image Loader** と **MOSS - Visual Regional Prompt** ノードを追加します。

**Empty** モードで空白キャンバスを作ります。MOSS ノード内に直接ボックスを描くか、個別の **VRP Region** ノードで領域を指定し、MOSS ノードの `canvas` と `regions` 入力に接続してください。各領域にはポジティブプロンプトを設定し、シーン全体はグローバルプロンプトで説明します。

MOSS に対応する CLIP を接続し、MOSS ノードの `positive` と `negative` 出力をサンプラーに渡します。初期 Latent には Canvas ローダーの `latent` を使います。

[![MOSS-Image SFT レイアウトプロンプトの例](../images/workflows/moss-sft-layout.webp)](../images/workflows/moss-sft-layout.webp)

詳しくは [MOSS レイアウトガイド](../moss-layout.md)（英語）をご覧ください。

### Anima の領域プロンプト用ワークフロー

以降、**Anima VRP** のコアノードを「Core」と表記します。

> [!IMPORTANT]
> Anima の領域条件付けは、構図の誘導や領域ごとのプロンプト指定に役立ちます。ただし、要素の位置を正確に固定するものではなく、プロンプトの影響が別の領域に及ぶこともあります。
>
> 構図をもっと細かく決めたい場合は、下の img2img ワークフローで **VRP の画像ローダー**と **LuCiD Canvas** を使ってみてください。インペイントなどの仕上げ処理には、別のワークフローが必要です。

> [!TIP]
> 以下の画像には、それぞれワークフローが埋め込まれています。元の画像を ComfyUI にドラッグすると、対応するサンプルを読み込めます。

#### img2img + Anima の領域プロンプト

VRP Canvas Image Loader の **Import** を押して、スケッチ、構図案、既存の画像を読み込みます。空白キャンバスに構図案を描いて始めることもできます。

**Edit canvas** で **LuCiD Canvas** を開き、構図を組み立てます。画像をレイヤーとして重ね、位置や形を調整したり、描き足したりできます。元画像を残したままトリミングや歪み変形も可能です。構図が決まったら **Apply** でローダーに反映してください。

対応する VAE を接続し、Latent モードを **Auto** のままにするか、**Encode** を選択します。ローダーの `canvas` と `latent` を、Core の `canvas` と `latent_image` にそれぞれ接続し、領域を設定します。Anima に対応する CLIP を Core に接続し、Core が出力するパッチ適用済みモデル、条件付けデータ（必要に応じて）、Latent をサンプラーに渡します。初期画像の影響を残すには、**denoise を 1.0 未満**にします。

> [!TIP]
> MOSS-Image は画面全体の構図作りが得意です。MOSS でラフを生成してから Anima の img2img に渡すと、両方の強みを活かせます。

[![Anima img2img の例](../images/workflows/anima-image-to-image.webp)](../images/workflows/anima-image-to-image.webp)

このワークフローのサンプル入力画像は[こちら](../images/workflows/anima-image-to-image-input-file.webp)です。

レイヤー編集、描画、変形、マスク、操作のカスタマイズについては、[LuCiD Canvas マニュアル](../canvas-tutorial.md)（英語）をご覧ください。

#### 内部領域のみを使う最小構成

**VRP Canvas Image Loader**、**Anima VRP** のコアノード、通常の Anima モデルローダーとサンプラーを用意します。

**Empty** モードで空白キャンバスを作り、ローダーの `canvas` と `latent` を Core の `canvas` と `latent_image` にそれぞれ接続します。Core 内に直接ボックスを描き、各領域を選択して名前、重み、ポジティブ・ネガティブプロンプトを編集します。Core がパッチ適用済みモデル、条件付けデータ、Latent をサンプラーに渡します。

[![Anima 最小構成の例](../images/workflows/anima-minimal.webp)](../images/workflows/anima-minimal.webp)

#### 外部領域を使う

領域ごとに **VRP Region** ノードを用意します。領域はボックスで指定するほか、標準の Mask Editor で描いたマスクや、外部から接続した `MASK` も使えます。

Region ノードを順につなぎ、**`canvas` と `regions` の両方**を Core まで渡します。各ノードの `regions` 出力を次のノードの `previous_regions` 入力に接続し、最後のノードから両方の出力を Core に接続します。

外部領域と Core 内のボックスは、組み合わせて使うこともできます。

[![Anima 外部領域の例](../images/workflows/anima-external-regions.webp)](../images/workflows/anima-external-regions.webp)

## ドキュメントとサンプル

以下の詳細ガイドは、現在英語のみです。

| ガイド | 内容 |
| --- | --- |
| [ノードリファレンス](../nodes.md) | ノードの選び方、接続、出力 |
| [画像ローダー](../image-loaders.md) | 読み込み、描画、サイズ変更、取り消し・やり直し、Latent モード、寸法の自動調整 |
| [LuCiD Canvas マニュアル](../canvas-tutorial.md) | レイヤー、描画、変形、歪み変形、元に戻せるトリミング、マスク |
| [Canvas クイックリファレンス](../canvas-reference.md) | エディターの操作、ショートカット、設定、保存される編集状態 |
| [MOSS レイアウトプロンプト](../moss-layout.md) | 内部・外部ボックス、シーンプロンプト、エンコード、MOSS 変換の制限 |
| [領域とプロンプト](../regions.md) | 内部ボックス、外部 Region の接続、マスク、Prompt Mix |
| [詳細設定](../advanced-settings.md) | 領域ルーティングのプリセット、制御項目、性能とのトレードオフ |
| [設定ファイル](../configuration.md) | 解像度プリセット、色、画面レイアウト、初期領域のカスタマイズ |
| [トラブルシューティング](../troubleshooting.md) | よくあるエラーと確認方法 |
| [互換性と制限事項](../limitations.md) | 対応環境と現在の機能範囲 |

## 既知の制限

- **ComfyUI の従来のノード表示（classic）にのみ対応しています。** Nodes 2.0 は現在未対応です。
- **領域指定だけで生成結果を完全に制御することはできません。** Anima の領域指定や MOSS-Image のレイアウトボックスで構図を誘導できますが、要素が必ず指定位置に現れるわけではありません。領域をまたいで特徴が混ざることもあり、指定したピクセルがそのまま残る保証もありません。
- **MOSS-Image 対応はまだ実験段階です。** 入力マスクは外接する長方形に変換されます。領域別のネガティブプロンプトは使えず、領域の重みは整数のみです。ネガティブプロンプトは全体に適用されます。
- **現時点では、** マスクを使ったインペイント、領域別 LoRA、組み込みの ControlNet 連携には対応していません。必要な場合は別のノードやワークフローを使ってください。
- **Anima のアテンションパッチは、他の拡張機能と競合する場合があります。** 特に、同じアテンション処理を変更する拡張機能が該当します。
- **ワークフローを保存するだけでは、画像編集用の素材がすべて保存されるわけではありません。** 編集内容や履歴を後から開けるように、参照元の画像、マスク、Canvas のレイヤー素材も残しておいてください。

詳しくは[互換性と制限事項](../limitations.md)（英語）をご覧ください。

## 謝辞

- [Sen-sou の ComfyUI-Anima-Regional-Conditioning](https://github.com/Sen-sou/Comfyui-Anima-Regional-Conditioning)：VRP の Anima 領域条件付けは、この実装をもとに改変しています。
- [OpenMOSS / MOSS-Image](https://github.com/OpenMOSS/MOSS-Image)：VRP の MOSS 連携で使用するモデルと、ネイティブなレイアウトプロンプト形式の資料です。
- [ComfyUI](https://github.com/Comfy-Org/ComfyUI) と [ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)：ホスト API、従来のノード表示、ネイティブなテキスト/VAE エンコードとサンプリング、Clipspace、および Region のマスクに使う標準 Mask Editor を提供します。
- 開発時の参考資料：[sd-forge-couple](https://github.com/Haoming02/sd-forge-couple)（ボックス操作）、[Anima-Artist-Mixer](https://github.com/An1X3R/Anima-Artist-Mixer)（モデルラッパーの動作）、[ComfyUI-Lora-Manager](https://github.com/willmiao/ComfyUI-Lora-Manager)（フロントエンドのライフサイクルとイベント処理）。
- [ComfyUI Prompt Control](https://github.com/asagi4/comfyui-prompt-control) は動作/API の参考、[Regional-Prompting-FLUX](https://github.com/instantX-research/Regional-Prompting-FLUX) は概念的な参考として調査しました。VRP に Prompt Control の実装はコピー・流用していません。

改変したコードに関する表記、ホストとの連携、開発時の参考資料については、[サードパーティーに関する表示](../../THIRD_PARTY_NOTICES.md)をご覧ください。

## ライセンス

LuCiD VRP が独自に作成したソフトウェアとドキュメント本文（**LuCiD Canvas** と **MOSS レイアウトノード**を含む）は、[MIT ライセンス](../../LICENSE)で公開しています。改変した第三者のコードには、それぞれの著作権表示とライセンス条件が引き続き適用されます。詳しくは[サードパーティーに関する表示](../../THIRD_PARTY_NOTICES.md)をご覧ください。

モデル、テキストエンコーダー、別途インストールするホストプロジェクトには、それぞれの利用条件が適用されます。
