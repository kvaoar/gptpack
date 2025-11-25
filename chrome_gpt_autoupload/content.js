console.log("GPTFOLDER(content): loaded");

(() => {
  let dirHandle = null;
  let lastUpload = {};
  let scanTimer = null;

  function log() {
    const args = Array.from(arguments);
    args.unshift("GPTFOLDER(content):");
    console.log.apply(console, args);
  }

  function dbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open("gpt_upload_db", 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("store");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(key, val) {
    try {
      const db = await dbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("store", "readwrite");
        tx.objectStore("store").put(val, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log("dbPut error", e);
      return false;
    }
  }

  async function dbGet(key) {
    try {
      const db = await dbOpen();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction("store", "readonly");
        const req = tx.objectStore("store").get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      log("dbGet error", e);
      return null;
    }
  }

  async function logPermission(handle) {
    if (!handle) {
      log("permission: no handle stored");
      return { status: "no_handle", reason: "no handle in DB" };
    }

    try {
      const qp = await handle.queryPermission({ mode: "readwrite" });
      let reason = "unknown";

      if (qp === "granted") reason = "granted (OK)";
      if (qp === "prompt") reason = "prompt: Chrome lost gesture/session";
      if (qp === "denied") reason = "denied: user or browser blocked";

      log("permission:", qp, "| reason:", reason);
      return { status: qp, reason };
    } catch (e) {
      log("permission query threw", e);
      return { status: "error", reason: e.message || String(e) };
    }
  }

  async function tryRestoreDirectory() {
    const stored = await dbGet("dirHandle");
    const info = await logPermission(stored);

    if (info.status === "granted") {
      dirHandle = stored;
      lastUpload = {};
      startScanner();
      log("restored directory from DB, button not needed");
      return true;
    }

    log("cannot auto-restore directory, need user gesture");
    return false;
  }

function alignButtonToSend(btn) {
  let alignTimer = null;

  function update() {
    if (alignTimer) clearTimeout(alignTimer);

    alignTimer = setTimeout(() => {
      const sendBtn =
        document.querySelector('button[aria-label="Send"]') ||
        document.querySelector('button[aria-label="Отправить"]') ||
        document.querySelector('[data-testid="send-button"]');
      if (!sendBtn) return;
      const r = sendBtn.getBoundingClientRect();
      const folderSize = 40;
      const offsetRight = folderSize * -2.0; 
      const bottom =
        window.innerHeight - (r.top + r.height / 2) - folderSize / 2;

      btn.style.bottom = `${bottom}px`;
      btn.style.right = `${
        (window.innerWidth - r.right) + offsetRight
      }px`;
    }, 50);
  }

  update();
  window.addEventListener("resize", update);
  window.addEventListener("scroll", update);

  const mo = new MutationObserver(update);
  mo.observe(document.body, { childList: true, subtree: true });
}

function createButton() {
  if (document.getElementById("gptfolder-btn")) return;

  const btn = document.createElement("button");
  btn.id = "gptfolder-btn";

  const iconURL = chrome.runtime.getURL("folder_icon.svg");

  btn.innerHTML = `<img src="${iconURL}" style="
      width: 22px;
      height: 22px;
      filter: invert(var(--gpt-folder-invert, 1));
      pointer-events: none;
  ">`;

  btn.style.position = "fixed";
  btn.style.zIndex = "999999";
  btn.style.width = "40px";
  btn.style.height = "40px";
  btn.style.borderRadius = "50%";
  btn.style.border = "1px solid rgba(0,0,0,0.15)";
  btn.style.display = "flex";
  btn.style.alignItems = "center";
  btn.style.justifyContent = "center";

  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  btn.style.background = dark ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.85)";
  btn.style.boxShadow = dark
      ? "0 2px 6px rgba(0,0,0,0.5)"
      : "0 2px 4px rgba(0,0,0,0.3)";
  btn.style.backdropFilter = "blur(4px)";
  btn.style.transition = "bottom 0.18s ease, right 0.18s ease";
  document.body.appendChild(btn);
  alignButtonToSend(btn);

  btn.addEventListener("click", async () => {
    await pickFolder();
  });
}

  function hideButton() {
    const btn = document.getElementById("gptfolder-btn");
    if (btn) btn.remove();
  }

  async function pickFolder() {
    try {
      if (!window.showDirectoryPicker) {
        log("showDirectoryPicker not available on this page");
        return;
      }

      dirHandle = await window.showDirectoryPicker();
      const perm = await dirHandle.requestPermission({ mode: "readwrite" });
      if (perm !== "granted") {
        log("permission not granted");
        dirHandle = null;
        return;
      }

      const ok = await dbPut("dirHandle", dirHandle);
      log("dirHandle stored in DB:", ok);

      lastUpload = {};
      startScanner();
      hideButton();
      log("folder chosen");
    } catch (e) {
      if (e && e.name === "AbortError") {
        log("folder picker aborted");
      } else {
        log("pickFolder error", e);
      }
    }
  }

  function startScanner() {
    if (scanTimer) clearInterval(scanTimer);
    scanTimer = setInterval(scanOnce, 2000);
    log("scanner started");
  }

  async function scanOnce() {
    if (!dirHandle) return;

    try {
      for await (const entry of dirHandle.values()) {
        if (entry.kind !== "file") continue;

        const file = await entry.getFile();
        const name = file.name;
        const lm = file.lastModified || 0;
        const prev = lastUpload[name] || 0;

        if (lm <= prev) continue;

        lastUpload[name] = lm;
        await uploadAndDelete(entry, file);
      }
    } catch (e) {
      log("scan error", e);
    }
  }

  function findInputInDocument(doc) {
    const candidates = Array.from(doc.querySelectorAll('input[type="file"]'));
    if (candidates.length) return candidates[0];
    return null;
  }

  function findFileInputDeep() {
    let el = findInputInDocument(document);
    if (el) return el;

    const iframes = Array.from(document.querySelectorAll("iframe"));
    for (const frame of iframes) {
      try {
        const doc = frame.contentDocument;
        if (!doc) continue;
        el = findInputInDocument(doc);
        if (el) return el;
      } catch (e) {
      }
    }
    return null;
  }

  function waitForInput() {
    const existing = findFileInputDeep();
    if (existing) {
      log("file input found immediately");
      return Promise.resolve(existing);
    }

    return new Promise((resolve) => {
      let resolved = false;

      const observer = new MutationObserver(() => {
        if (resolved) return;
        const el = findFileInputDeep();
        if (el) {
          resolved = true;
          log("file input found via observer");
          try { observer.disconnect(); } catch (e) {}
          resolve(el);
        }
      });

      observer.observe(document.documentElement, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { observer.disconnect(); } catch (e) {}
          resolve(null);
        }
      }, 10000);
    });
  }

  async function uploadAndDelete(entry, file) {
    const input = await waitForInput();
    if (!input) {
      log("file input not found");
      return;
    }
    try {
      log("uploading", file.name);

      const buf = await file.arrayBuffer();
      const blob = new Blob([buf], { type: file.type || "application/octet-stream" });
      const patched = new File([blob], file.name, { type: blob.type });

      const dt = new DataTransfer();
      dt.items.add(patched);
      input.files = dt.files;

      input.dispatchEvent(new Event("change", { bubbles: true }));
      log("uploaded OK", file.name);

      try {
        const parent = dirHandle;
        if (parent && entry && entry.name) {
          await parent.removeEntry(entry.name);
          log("deleted file", entry.name);
        }
      } catch (e) {
        log("delete failed", e);
      }
    } catch (e) {
      log("upload error", e);
    }
  }

  async function init() {
    log("init start");

    let restored = false;
    try {
      restored = await tryRestoreDirectory();
    } catch (e) {
      log("init restore error", e);
    }

    if (!restored) {
      createButton();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
