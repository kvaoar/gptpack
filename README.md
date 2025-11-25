# GPTPack — packaging projects and instantly sending them to ChatGPT
GPTPack is an ecosystem of tools (CLI, Shell Extension, and Chrome plugin) that allows you to  
**create ZIP archives of any folders and automatically send them to an open ChatGPT chat in one action**.
The project solves the problem of constantly transferring files, version confusion, loss of context,  
and turns uploading source code to ChatGPT into a normal, streamlined workflow.
---

# 📌 1. Purpose of the project
GPTPack allows you to:
- Package any source directory into a ZIP archive.  
- Create archives strictly in `C:\gpt_upload`.  
- Automatically send the archive to ChatGPT through the Chrome plugin.  
- Trigger sending via **right-click** → *Send to ChatGPT* using Custom Context Menu (Windows 11).
---

# 📦 2. GPTPack installation
### Requirements
- Windows 11 x64  
- PowerShell  
- Chrome  
### Installation steps
1. Extract the project.  
2. Run the installation script:
```powershell
.\install.ps1
```
The script creates:
```
C:\gptpack\
    gptpack.exe
C:\gpt_upload\
```
---

# 🖱 3. Installing the Windows 11 context menu (Custom Context Menu)
The project already includes a ready configuration file:  
**gptpack.json**
It contains the full setup for the context-menu item:
- Name: **Send to ChatGPT**
- Command:
  ```
  "C:\\gptpack\\gptpack.exe" "{path}"
  ```
- Icon:
  ```
  "C:\\gptpack\\gptpack.exe",0
  ```

## Installation:
1. Install the utility:  
   https://github.com/ikas-mc/ContextMenuForWindows11
2. Launch the program → **Open Menu Config File**.
3. Place the file:
```
gptpack.json
```
into the directory that opens.
4. A new item will appear in File Explorer:
> **Send to ChatGPT**
It works reliably in the new Windows 11 context menu.
---

# 🔧 4. Chrome plugin
The GPTPack Chrome extension monitors new ZIP files and automatically uploads them to the chat.
### To allow it to read `C:\gpt_upload`:
1. Click the GPTPack extension icon in Chrome (the button in the toolbar next to the ChatGPT send button).  
2. In the popup, press **Grant folder access**.  
3. Chrome will open the native directory selection dialog.  
4. Select:
```
C:\gpt_upload
```
5. Confirm the choice.
The extension will receive the `FileSystemDirectoryHandle` and begin monitoring.
---

# 🚀 5. Quick usage scenario
1. Right-click any project folder.  
2. Choose **Send to ChatGPT**.  
3. GPTPack creates a ZIP in `C:\gpt_upload`.  
4. The Chrome plugin detects the new ZIP.  
5. The archive is uploaded directly to the chat.

---

