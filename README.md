<div align="center">

<img src=".github/assets/logo.png" width="112" alt="ZeroCord logo">

# ZeroCord

**A Discord client mod with 370+ plugins, themes, an animated background and its own plugins, all inside Discord's settings.**

![Version](https://img.shields.io/badge/version-2.0.0-ff5c8a?style=flat-square)
![Platform](https://img.shields.io/badge/platform-Windows-5865F2?style=flat-square)
![Discord](https://img.shields.io/badge/Discord-Stable%20%7C%20PTB%20%7C%20Canary-5865F2?style=flat-square)
![License](https://img.shields.io/badge/license-GPL--3.0-23a55a?style=flat-square)

<img src=".github/assets/installer.png" width="720" alt="ZeroCord installer">

</div>

## Features

Everything lives inside Discord's own settings, under **ZeroCord Settings → Plugins**. ZeroCord's plugins carry the ZeroCord badge and keep their options under the ⚙ cog.

| Plugin | What it does |
|---|---|
| **370+ Equicord plugins** | The full [Equicord](https://github.com/Equicord/Equicord) catalog, ready to toggle. |
| **FakeMute** | Adds a button next to your mic and headphones. When on, everyone in the call sees you as muted (and optionally deafened) while you keep talking and listening. |
| **AnimatedBackground** | Use any video, GIF or image as your Discord background, with adjustable intensity and blend mode. |
| **ZeroCordThemes** | Six built-in themes plus any `.css` theme file or link, toggled individually. |
| **LocalProfile** | Change your display name, username, avatar and badges. Only you see these changes. |
| **Performance** | Fewer animations, blocked telemetry and interface zoom. |

ZeroCord also installs into the official Discord **Stable, PTB and Canary** clients, stays installed across Discord updates and can give Discord a Zero Two icon.

## Installation

1. Download **[ZeroCord-Installer.exe](https://github.com/odeiofavelado/ZeroCord/releases/latest/download/ZeroCord-Installer.exe)** from the [latest release](https://github.com/odeiofavelado/ZeroCord/releases/latest).
2. Close Discord.
3. Run `ZeroCord-Installer.exe`, select your Discord clients and click **Install**.

No Node.js or setup required. Works on Windows 10 and 11.

> [!NOTE]
> Windows SmartScreen may warn you because the installer isn't code-signed. Click **More info → Run anyway**.

<details>
<summary><b>Install from source</b></summary>

Requires [Node.js](https://nodejs.org) (LTS). Download the source (**Code → Download ZIP**), extract it and run **`Install.bat`**.

</details>

### Uninstalling

Run the installer again and click **Uninstall**. Discord goes back to normal, including its original icon. You can choose to keep or delete your settings.

### Running as a standalone app

ZeroCord can also run in its own window without touching your Discord installation:

```bash
npm install
node node_modules/electron/install.js
npm start
```

## Usage

1. Open Discord **Settings** and scroll to **ZeroCord Settings**.
2. Open **Plugins** and turn on what you want. Use the ⚙ cog on a plugin to change its options.
3. For custom sounds and CSS, use Equicord's **CustomSounds** plugin and **QuickCSS**.

Your ZeroCord files (background, themes, profile pictures) are stored in `%APPDATA%\ZeroCord`. Drop any `.css` file into its `themes` folder and it shows up in **ZeroCordThemes**.

## Building

```bash
npm run build             # standalone portable app   -> dist/app
npm run build:installer   # portable installer (.exe) -> dist/installer
```

Pushing a `v*` tag builds the installer on GitHub Actions and publishes it as a release.

## Project structure

```
src/
├── core.js          Shared core: config, themes, settings IPC, plugin engine
├── patcher.js       Entry point inside the official Discord client
├── standalone.js    Entry point for the standalone app
├── preload.js       Injects the plugin engine before Discord loads
├── runtime.js       In-page features and ZeroCord's plugins inside Discord's settings
├── themes/          Built-in themes
└── vendor/          Bundled Equicord / Vencord builds
installer/           The installer app
```

## Disclaimer

Client modifications are against Discord's [Terms of Service](https://discord.com/terms). Bans for using them are rare, but you use ZeroCord at your own risk. Avoid plugins that automate actions or send messages on your behalf.

To make plugins and themes work, ZeroCord disables Discord's Content Security Policy, as Vencord and Equicord do.

## Credits

- [Equicord](https://github.com/Equicord/Equicord) and [Vencord](https://github.com/Vendicated/Vencord): plugin engines (GPL-3.0)
- [merlinfuchs/discord-badges](https://github.com/merlinfuchs/discord-badges): badge icons (MIT)
- Zero Two artwork and scenes from *Darling in the FranXX* (Studio Trigger / CloverWorks). Installer icon art by **fantoramu**.

ZeroCord is not affiliated with Discord Inc.

## License

[GPL-3.0](LICENSE)
