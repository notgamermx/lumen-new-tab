# Lumen

A new-tab extension for Chrome and Edge. Use a local video as your wallpaper, or pick one of three animated backgrounds.

![Lumen new-tab page with an animated aurora background, clock, search and shortcuts](docs/images/new-tab.png)

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Open a new tab. Use **Customize** to choose a wallpaper and change your settings.

No build step is needed to install the extension. Keep its folder in place after loading it.

## Features

- MP4 and WebM wallpapers, plus JPG, PNG and WebP images.
- Brightness, blur, saturation, playback speed and crop positioning.
- Clock fonts, sizes, colors, alignment, seconds and time zones.
- Custom greetings and up to 12 editable shortcuts.
- Separate visibility controls for the clock, date, search, greeting and shortcuts.
- Wallpaper-only mode and automatic playback pause in background tabs.

![Customization panel with presets, colors, clock fonts and layout controls](docs/images/customization.png)

Videos loop without audio. Files can be up to 150 MB, subject to available browser storage. Short videos load faster.

Wallpaper files and settings stay in the browser profile. Lumen has no analytics, accounts or remote wallpaper requests. Search and shortcut links open the websites you choose. See [privacy details](docs/privacy.md).

## Updating

Replace the files in the same installed folder, click **Reload** on the Extensions page, and open a new tab. Removing the extension clears its saved data.

If you previously loaded the older `Wallpaper/lumen` folder, keep that installation for now. Loading this project's `extension` folder separately can give it a different extension ID and separate storage. To keep the old installation's wallpaper and settings, copy the contents of `extension` into the old installed folder and reload it.

## Development

Node.js 22 or newer is needed for development commands. The extension itself uses plain JavaScript and has no runtime dependencies.

```sh
npm ci
npm test
npm run check
npm run package
```

The ZIP is written to `dist/`. `npm run format` formats source files. GitHub Actions runs formatting, syntax and preference checks and builds the ZIP on pushes and pull requests.

Run the browser checks with `npm run test:browser`. They use an isolated headless Edge profile on Windows. Set `BROWSER_PATH` to another compatible Chromium browser executable if needed. Browser checks are local; they are not included in CI. Generated screenshots, media fixtures and profiles go in the ignored `test-results` directory.

```text
extension/          Load this folder in the browser
  assets/           Icons
  scripts/          Page logic, preferences, storage and animation
  styles/           Page and settings styles
tests/              Preference and browser checks
scripts/            Source validation and ZIP packaging
docs/               Privacy information
.github/workflows/  CI configuration
```

## Limitations

The extension replaces the new-tab page only. Chrome does not allow this override in incognito windows. Another new-tab extension may take priority. Video support depends on the browser's codecs; an unsupported file is rejected before it replaces the saved wallpaper. Firefox is not tested.
