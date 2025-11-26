
# GPTPack — Project Packaging and One‑Click Upload to ChatGPT

GPTPack is a small utility that **packs any project folder into a ZIP archive** and
**automatically delivers it into an open ChatGPT chat** using the companion Chrome extension.

This workflow solves the problem of:
- losing context between iterations,
- sending scattered files,
- keeping multiple versions manually,
- re‑uploading the same data repeatedly.

GPTPack makes file exchange with ChatGPT predictable, structured and fast.

---

## 1. Purpose

GPTPack is designed to:

- Create clean ZIP archives of source projects  
- Exclude useless binary garbage via configurable rules  
- Save archives strictly into `C:\gpt_upload`  
- Trigger automatic upload to ChatGPT (via Chrome extension)  
- Enable a Windows 11 context‑menu entry **Send to ChatGPT**  

It is intended as a frictionless “send my current project to ChatGPT” workflow.

---

## 2. Installation

### Requirements
- Windows 11 (x64)
- PowerShell
- Go compiler (installer installs it automatically if missing)
- Chrome browser (for auto‑upload extension)

### Steps

1. Unpack the project.
2. Run:
   ```powershell
   .\install_gptpack.ps1
   ```
3. Installer will:
   - generate the Windows resource file (.syso),
   - build `gptpack.exe`,
   - copy `gptpack.config.json` to `C:\gptpack`,
   - create `C:\gpt_upload` if missing.

You can now run:
```
C:\gptpack\gptpack.exe <folder>
```

---

## 3. Configuration File (`gptpack.config.json`)

GPTPack uses this JSON to control its filtering behavior:

```json
{
  "outputDir": "C:\\gpt_upload",

  "skipDirs": [
    ".git", ".svn", ".hg",
    ".idea", ".vscode",
    "node_modules",
    "dist", "build", "out", "bin", "obj",
    "__pycache__", ".mypy_cache", ".pytest_cache",
    ".cache", ".gradle", ".cargo", "target",
    ".nuget", "packages",
    "env", "venv", ".venv"
  ],

  "skipExt": [
    ".exe", ".dll", ".so", ".dylib",
    ".a", ".lib", ".o", ".obj",
    ".class", ".jar", ".war", ".ear",
    ".pyc", ".bin", ".dat", ".pack", ".iso",
    ".zip", ".7z", ".rar", ".tar", ".gz", ".xz", ".bz2",
    ".onnx", ".tflite", ".pth", ".pt", ".ckpt", ".safetensors",
    ".pb", ".h5",
    ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".webp", ".svg",
    ".ico", ".icns",
    ".mp4", ".mkv", ".mov", ".avi", ".webm", ".mp3", ".wav", ".aac",
    ".pdf", ".psd"
  ],

  "skipBinaryNoExt": true,
  "ignoreFile": ".gptpackignore"
}
```

### Meaning of keys
- **outputDir** — where final ZIP files are written  
- **skipDirs** — directory names that must be fully excluded (whole subtree)  
- **skipExt** — extensions always skipped  
- **skipBinaryNoExt** — skip extensionless files if binary  
- **ignoreFile** — extra ignore list placed in the scanned project root  

---

## 4. Windows 11 Context Menu Integration

GPTPack ships with a ready configuration file for  
**Custom Context Menu for Windows 11**:

`gptpack.json`

To enable:

1. Install:  
   https://github.com/ikas-mc/ContextMenuForWindows11

2. Open menu config folder inside the app.

3. Copy `gptpack.json` into that folder.

4. A new right‑click option appears: **Send to ChatGPT**.

This invokes:
```
"C:\gptpack\gptpack.exe" "<selected_folder>"
```

---

## 5. Chrome Extension Permission (auto‑upload)

The extension automatically uploads any new ZIP appearing in `C:\gpt_upload`.

To enable folder access:

1. Click GPTPack extension icon in Chrome.
2. Click **Grant folder access**.
3. Select:
   ```
   C:\gpt_upload
   ```
4. Confirm.

The extension receives a persistent `FileSystemDirectoryHandle` and begins monitoring automatically.

---

## 6. Usage Workflow

1. Right‑click any folder → **Send to ChatGPT**  
2. GPTPack collects and filters files  
3. ZIP is generated in `C:\gpt_upload`  
4. Chrome extension sees the new file  
5. Upload happens instantly into the open ChatGPT chat  

This produces consistent, reproducible uploads without manual fumbling.

---

## 7. Notes

- All skipping logic is logged inside `_gptpack_log.txt` inside each ZIP.
- Only text‑relevant files are included to keep archives clean and readable.
- Configuration is fully customizable by editing the JSON in `C:\gptpack`.

---
