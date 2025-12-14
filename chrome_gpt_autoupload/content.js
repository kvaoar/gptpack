console.log("GPTFOLDER(content): loaded");

let sizeCache = {};

(() => {
    let dirHandle = null;
    let lastUpload = {};
    let scanTimer = null;

    const INBOX_FILE = "chatgpt_incoming.txt";
    const OUTBOX_FILE = "chatgpt_outgoing.txt";
    const CONTROL_FILES = new Set([INBOX_FILE, OUTBOX_FILE]);
    let chatObserver = null;
    let outboxTimer = null;
    let lastSeenMsgKey = null;
    let lastOutboxSig = null;
    let pendingMsg = null;
    let pendingTimer = null;
    let lastChatId = null;
    let pendingLen = 0;
    let genSeen = false;
    let genEndedAt = 0;


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
            startChatBridge();
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
                    document.querySelector('[data-testid="send-button"]');
                if (!sendBtn) return;
                const r = sendBtn.getBoundingClientRect();
                const folderSize = 40;
                const offsetRight = folderSize * -2.0;
                const bottom =
                    window.innerHeight - (r.top + r.height / 2) - folderSize / 2;

                btn.style.bottom = `${bottom}px`;
                btn.style.right = `${(window.innerWidth - r.right) + offsetRight}px`;
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
        btn.style.background = dark
            ? "rgba(255,255,255,0.10)"
            : "rgba(255,255,255,0.85)";
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
            sizeCache = {};
            startScanner();
            startChatBridge();
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

                if (CONTROL_FILES.has(name)) continue;
                const lm = file.lastModified || 0;
                const prevLm = lastUpload[name] || 0;
                const prev = sizeCache[name] || { size: 0, t: 0 };
                if (file.size !== prev.size) {
                    sizeCache[name] = { size: file.size, t: Date.now() };
                    continue;
                }
                if (Date.now() - prev.t < 1500) {
                    continue;
                }
                if (lm <= prevLm) continue;
                lastUpload[name] = lm;
                await uploadAndDelete(entry, file);
                delete sizeCache[name];
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
            } catch (e) { }
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
                    try { observer.disconnect(); } catch (e) { }
                    resolve(el);
                }
            });
            observer.observe(document.documentElement, {
                childList: true,
                subtree: true,
                characterData: true
            });
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    try { observer.disconnect(); } catch (e) { }
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

    function startChatBridge() {
        if (!dirHandle) return;
        startChatLogging();
        startOutboxPolling();
    }

    function safeNowIso() {
        try {
            return new Date().toISOString();
        } catch {
            return String(Date.now());
        }
    }

    function canSend() {
        return !!document.querySelector('[data-testid="send-button"]');
    }

    function currentChatId() {
        const m = location.pathname.match(/\/c\/([^\/]+)/);
        return m ? m[1] : null;
    }

    function buttonRole() {
        if (document.querySelector('[data-testid="stop-button"]')) return "stop";
        if (document.querySelector('[data-testid="send-button"]')) return "send";
        return "unknown";
    }


    function isGenerating() {
        return buttonRole() === "stop";
    }


    async function appendTextFile(filename, text) {
        if (!dirHandle) return;
        try {
            const h = await dirHandle.getFileHandle(filename, { create: true });
            const f = await h.getFile();
            const w = await h.createWritable({ keepExistingData: true });
            await w.seek(f.size);
            await w.write(text);
            await w.close();
        } catch (e) {
            log("appendTextFile failed", filename, e);
        }
    }

    function extractLastMessage() {
        const nodes = Array.from(document.querySelectorAll('[data-message-author-role]'));
        if (nodes.length) {
            const n = nodes[nodes.length - 1];
            const role = n.getAttribute('data-message-author-role') || 'unknown';
            const text = (n.innerText || n.textContent || '').trim();
            return text ? { role, text } : null;
        }

        const arts = Array.from(document.querySelectorAll('article'));
        if (arts.length) {
            const n = arts[arts.length - 1];
            const text = (n.innerText || n.textContent || '').trim();
            return text ? { role: 'unknown', text } : null;
        }

        return null;
    }

    function msgKey(m) {
        const t = m.text.length > 200 ? m.text.slice(0, 200) : m.text;
        return `${m.role}|${t}`;
    }

    function onChatMutation() {
        const cid = currentChatId();
        if (cid !== lastChatId) {
            lastChatId = cid;
            lastSeenMsgKey = null;
            genSeen = false;
            genEndedAt = 0;
        }

        const m = extractLastMessage();
        if (!m || m.role !== "assistant") return;
        pendingMsg = m;

        if (isGenerating()) {
            genSeen = true;
            genEndedAt = 0;
            return;
        }

        if (!genSeen) return;

        if (!genEndedAt) {
            genEndedAt = Date.now();
            return;
        }

        if (Date.now() - genEndedAt < 1000) return;

        log(
            "GEN",
            isGenerating(),
            "genSeen=", genSeen,
            "endedAt=", genEndedAt && (Date.now() - genEndedAt)
        );


        const k = msgKey(pendingMsg);
        if (k === lastSeenMsgKey) return;
        lastSeenMsgKey = k;

        appendTextFile(
            INBOX_FILE,
            `\n[${safeNowIso()}] role=${pendingMsg.role}\n${pendingMsg.text}\n`
        );

        pendingMsg = null;
        genSeen = false;
        genEndedAt = 0;
    }

    function startChatLogging() {
        try {
            if (chatObserver) {
                try { chatObserver.disconnect(); } catch { }
                chatObserver = null;
            }
            if (pendingTimer) {
                try { clearInterval(pendingTimer); } catch { }
                pendingTimer = null;
            }

            const root = document.documentElement;
            if (!root) return;

            chatObserver = new MutationObserver(() => {
                Promise.resolve().then(onChatMutation);
            });

            chatObserver.observe(root, {
                childList: true,
                subtree: true,
                characterData: true,
                attributes: true
            });

            pendingTimer = setInterval(() => {
                try {
                    onChatMutation();
                } catch (e) {
                }
            }, 250);

            Promise.resolve().then(onChatMutation);
            log("chat logging enabled ->", INBOX_FILE);
        } catch (e) {
            log("startChatLogging error", e);
        }
    }

    async function readOutbox() {
        if (!dirHandle) return null;
        try {
            const h = await dirHandle.getFileHandle(OUTBOX_FILE, { create: true });
            const f = await h.getFile();
            const text = (await f.text()).trim();
            return { handle: h, file: f, text };
        } catch (e) {
            log("readOutbox failed", e);
            return null;
        }
    }

    async function clearOutbox() {
        if (!dirHandle) return;
        try {
            const h = await dirHandle.getFileHandle(OUTBOX_FILE, { create: true });
            const w = await h.createWritable();
            await w.write("");
            await w.close();
        } catch (e) {
            log("clearOutbox failed", e);
        }
    }


    function findComposer() {
        const ce =
            document.querySelector('[contenteditable="true"][role="textbox"]') ||
            document.querySelector('[contenteditable="true"]');
        if (ce) return { kind: "contenteditable", el: ce };
        return null;
    }

    function findSendButton() {
        return (
            document.querySelector('[data-testid="send-button"]')
        );
    }

    function setComposerText(c, text) {
        try {
            c.el.focus();
            if (c.kind === "textarea") {
                c.el.value = text;
            } else {
                document.execCommand("selectAll", false, null);
                document.execCommand("delete", false, null);
                document.execCommand("insertText", false, text);
            }
            c.el.dispatchEvent(new Event("input", { bubbles: true }));
            return true;
        } catch (e) {
            log("setComposerText failed", e);
            return false;
        }
    }

    async function sendTextToChat(text) {
        const c = findComposer();
        if (!c) return false;

        if (!setComposerText(c, text)) return false;
        let btn = null;
        for (let i = 0; i < 10; i++) {
            btn = document.querySelector('[data-testid="send-button"]');
            if (btn && !btn.disabled) break;
            await new Promise(r => setTimeout(r, 100));
        }

        if (!btn || btn.disabled) {
            log("sendTextToChat: send button not available");
            return false;
        }

        try {
            btn.click();
            return true;
        } catch {
            return false;
        }
    }

    function outboxSig(file, text) {
        const lm = file && file.lastModified ? file.lastModified : 0;
        const sz = file && typeof file.size === "number" ? file.size : 0;
        return `${lm}|${sz}|${text.slice(0, 80)}`;
    }

    async function pollOutboxOnce() {

        if (!canSend()) return;

        const o = await readOutbox();
        if (!o) return;

        const sig = outboxSig(o.file, o.text);
        if (sig === lastOutboxSig) return;
        lastOutboxSig = sig;

        if (!o.text) return;

        const payload = o.text.length > 20000 ? o.text.slice(0, 20000) : o.text;
        const ok = await sendTextToChat(payload);
        if (ok) await clearOutbox();
    }

    function startOutboxPolling() {
        if (outboxTimer) clearInterval(outboxTimer);
        outboxTimer = setInterval(() => {
            pollOutboxOnce().catch(e => log("pollOutboxOnce error", e));
        }, 1000);
        log("outbox polling enabled <-", OUTBOX_FILE);
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
