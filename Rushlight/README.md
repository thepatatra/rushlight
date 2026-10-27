# Rushlight – technical notes

Overview and installation: see the [main README](../README.md). History: [CHANGELOG.md](../CHANGELOG.md).
Code comments are written in French.

## Structure

| File | Role |
|---|---|
| `CSXS/manifest.xml` | CEP extension manifest (Premiere Pro 15+) and version number. |
| `index.html`, `css/style.css`, `img/` | The panel. |
| `js/i18n.js` | Panel translations (French / English) and language detection. |
| `js/main.js` | Audio analysis with ffmpeg (Node.js), cut computation, zones, backups, settings. |
| `js/highlights.js` | Highlight detection from the volume measurements. |
| `jsx/host.jsx` | Premiere side (ExtendScript): cutting, closing up, markers, safety checks. Saved as UTF-8 with BOM. |
| `sign.ps1` / `sign.bat` | Signs the extension with a local certificate and produces `Rushlight.zxp`. |
| `install.ps1` / `install.bat` | Installs the signed version into `%APPDATA%\Adobe\CEP\extensions`. |
| `package.ps1` | Signs and builds the release ZIP in `dist/`. |

## After a change

1. Bump the version in `CSXS/manifest.xml` (`ExtensionBundleVersion` and `Version`) and add an entry to the
   [CHANGELOG](../CHANGELOG.md). The panel shows this number next to its title.
2. Premiere Pro 2025+ only loads signed extensions: run `sign.bat`, then `install.bat` (with Premiere closed).
3. New panel text goes into both languages in `js/i18n.js`.

## Release

Run `package.ps1`: it signs the extension and creates `dist/Rushlight-vX.Y.Z.zip` (install scripts, signed
extension, license). Attach that ZIP to a GitHub release.

## Debugging

With the panel open, the console is available at http://localhost:8098 in Chrome.
