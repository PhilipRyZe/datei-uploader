// Trag hier die URL deines Uploader-Workers ein (siehe Einrichtungsanleitung)
const API_BASE = "https://files.pjanssen.cc";

const CHUNK_SIZE = 8 * 1024 * 1024; // 8 MB pro Teil (über R2s 5-MB-Minimum)

const dropzone = document.getElementById("dropzone");
const dropzoneText = document.getElementById("dropzone-text");
const fileInput = document.getElementById("fileInput");
const fileInfo = document.getElementById("fileInfo");
const fileNameEl = document.getElementById("fileName");
const fileSizeEl = document.getElementById("fileSize");
const expirySelect = document.getElementById("expirySelect");
const uploadButton = document.getElementById("uploadButton");
const progressContainer = document.getElementById("progressContainer");
const progressBar = document.getElementById("progressBar");
const progressLabel = document.getElementById("progressLabel");
const result = document.getElementById("result");
const shareUrlInput = document.getElementById("shareUrl");
const copyButton = document.getElementById("copyButton");
const expiryNote = document.getElementById("expiryNote");
const message = document.getElementById("message");

let selectedFile = null;

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = -1;
    do {
        value /= 1024;
        unitIndex++;
    } while (value >= 1024 && unitIndex < units.length - 1);
    return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function selectFile(file) {
    selectedFile = file;
    fileNameEl.textContent = file.name;
    fileSizeEl.textContent = formatBytes(file.size);
    fileInfo.classList.remove("hidden");
    dropzoneText.textContent = "Andere Datei wählen";
    uploadButton.disabled = false;
    message.textContent = "";
    result.classList.add("hidden");
}

dropzone.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
    if (fileInput.files.length) selectFile(fileInput.files[0]);
});

["dragover", "dragenter"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });
});

["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
    });
});

dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
});

function updateProgress(fraction) {
    const percent = Math.min(100, Math.round(fraction * 100));
    progressBar.style.width = percent + "%";
    progressLabel.textContent = percent + "%";
}

// Lädt einen einzelnen Chunk hoch und meldet den Fortschritt über XHR
// (fetch() kann Upload-Fortschritt nicht nativ tracken)
function uploadPart(key, uploadId, partNumber, chunk, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const partUrl = `${API_BASE}/api/upload/part?key=${encodeURIComponent(key)}&uploadId=${encodeURIComponent(uploadId)}&partNumber=${partNumber}`;

        xhr.open("PUT", partUrl);
        xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) onProgress(e.loaded);
        });
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(JSON.parse(xhr.responseText));
                } catch (err) {
                    reject(err);
                }
            } else {
                reject(new Error(`Teil ${partNumber} fehlgeschlagen (Status ${xhr.status})`));
            }
        };
        xhr.onerror = () => reject(new Error(`Netzwerkfehler bei Teil ${partNumber}`));
        xhr.send(chunk);
    });
}

async function uploadFile(file, expiryDays) {
    // 1) Upload initialisieren
    const initRes = await fetch(`${API_BASE}/api/upload/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            expiryDays,
        }),
    });

    if (!initRes.ok) {
        const err = await initRes.json().catch(() => ({}));
        throw new Error(err.error || "Upload konnte nicht gestartet werden.");
    }

    const { code, key, uploadId } = await initRes.json();

    // 2) Datei in Chunks aufteilen und nacheinander hochladen
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const parts = [];
    let uploadedBytes = 0;

    try {
        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, file.size);
            const chunk = file.slice(start, end);
            const chunkSize = end - start;

            const result = await uploadPart(key, uploadId, i + 1, chunk, (loadedInChunk) => {
                updateProgress((uploadedBytes + loadedInChunk) / file.size);
            });

            parts.push({ partNumber: i + 1, etag: result.etag });
            uploadedBytes += chunkSize;
            updateProgress(uploadedBytes / file.size);
        }
    } catch (err) {
        // Bei einem Fehler den angefangenen Upload wieder aufräumen
        fetch(`${API_BASE}/api/upload/abort`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, key, uploadId }),
        }).catch(() => {});
        throw err;
    }

    // 3) Upload abschließen
    const completeRes = await fetch(`${API_BASE}/api/upload/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, key, uploadId, parts }),
    });

    if (!completeRes.ok) {
        throw new Error("Upload konnte nicht abgeschlossen werden.");
    }

    return code;
}

uploadButton.addEventListener("click", async () => {
    if (!selectedFile) return;

    message.textContent = "";
    result.classList.add("hidden");
    uploadButton.disabled = true;
    progressContainer.classList.remove("hidden");
    updateProgress(0);

    const expiryDays = parseInt(expirySelect.value, 10);

    try {
        const code = await uploadFile(selectedFile, expiryDays);
        const shareUrl = `${API_BASE}/download/${code}`;

        shareUrlInput.value = shareUrl;
        result.classList.remove("hidden");
        expiryNote.textContent = `Der Link läuft in ${expiryDays} Tag${expiryDays === 1 ? "" : "en"} automatisch ab.`;
        progressContainer.classList.add("hidden");
    } catch (err) {
        message.textContent = `Fehler: ${err.message || "Upload fehlgeschlagen"}`;
        progressContainer.classList.add("hidden");
    } finally {
        uploadButton.disabled = false;
    }
});

copyButton.addEventListener("click", async () => {
    try {
        await navigator.clipboard.writeText(shareUrlInput.value);
        copyButton.textContent = "Kopiert!";
        setTimeout(() => {
            copyButton.textContent = "Kopieren";
        }, 1500);
    } catch {
        message.textContent = "Kopieren nicht möglich.";
    }
});
