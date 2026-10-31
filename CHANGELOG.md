# Changelog

## 0.1.2 — 2026-10-31

### Documentation

- Added Simplified Chinese, Traditional Chinese and Japanese READMEs with language navigation.
- Added multilingual sections and language-specific documentation links to the compact Registry README.
- Fixed the Registry branch's installation-prerequisites link to open the full documentation on `main`.

This release updates documentation and package metadata; runtime behavior is unchanged.

## 0.1.1 — 2026-10-30

### Fixed

- Fixed `crypto.randomUUID is not a function` when using ComfyUI through a remote HTTP address.
- Restored image-loader initialization, image imports and drag-and-drop for both Canvas and Standalone Image Loaders.
- Fixed LuCiD Canvas image drops, layer creation, painting, mask editing, Apply, reopening saved assets and resizing on those connections.
- Added shared UUID generation using `crypto.getRandomValues()` when native `crypto.randomUUID()` is unavailable.

Existing saved documents and workflows remain compatible. The patch adds no dependencies.

### Validation

- All 14 frontend suites, 28 loader browser checks, 60 editor browser checks and nine backend bridge tests passed.
- Browser coverage includes a non-loopback HTTP origin without `crypto.randomUUID()`, using real PNG processing and uploads with mocked ComfyUI graph APIs.
- GitHub and Registry package checks, sample validation and all six packaging tests passed.
