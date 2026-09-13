// Trag hier dieselbe URL wie in script.js ein
const API_BASE = "https://files.pjanssen.cc";

const loginGate = document.getElementById("loginGate");
const adminContent = document.getElementById("adminContent");
const adminKeyInput = document.getElementById("adminKeyInput");
const loginButton = document.getElementById("loginButton");
const loginError = document.getElementById("loginError");
const usageBar = document.getElementById("usageBar");
const usageLabel = document.getElementById("usageLabel");
const refreshButton = document.getElementById("refreshButton");
const fileTableBody = document.getElementById("fileTableBody");
const emptyState = document.getElementById("emptyState");

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

function formatDate(ts) {
    if (!ts) return "–";
    return new Date(ts).toLocaleString("de-DE");
}

function getAdminKey() {
    return sessionStorage.getItem("adminKey") || "";
}

// Zentraler Fetch-Wrapper: hängt den Admin-Schlüssel an und schickt bei
// abgelaufenem/falschem Schlüssel automatisch zurück zum Login-Formular.
async function adminFetch(path, options = {}) {
    const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...(options.headers || {}),
            "X-Admin-Key": getAdminKey(),
        },
    });
    if (res.status === 401) {
        sessionStorage.removeItem("adminKey");
        showLogin("Schlüssel ungültig oder abgelaufen. Bitte erneut eingeben.");
        throw new Error("unauthorized");
    }
    return res;
}

function showLogin(errorMsg = "") {
    loginGate.classList.remove("hidden");
    adminContent.classList.add("hidden");
    loginError.textContent = errorMsg;
}

function showAdmin() {
    loginGate.classList.add("hidden");
    adminContent.classList.remove("hidden");
    loadFiles();
}

loginButton.addEventListener("click", () => {
    const key = adminKeyInput.value.trim();
    if (!key) return;
    sessionStorage.setItem("adminKey", key);
    showAdmin();
});

adminKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") loginButton.click();
});

async function loadFiles() {
    try {
        const res = await adminFetch("/api/admin/files");
        if (!res.ok) throw new Error("Fehler beim Laden");
        const data = await res.json();
        renderStats(data.usedBytes, data.maxBytes);
        renderFiles(data.files);
    } catch (err) {
        if (err.message !== "unauthorized") {
            fileTableBody.innerHTML = "";
            emptyState.classList.remove("hidden");
            emptyState.textContent = "Fehler beim Laden der Dateien.";
        }
    }
}

function renderStats(used, max) {
    const percent = Math.min(100, (used / max) * 100);
    usageBar.style.width = percent + "%";
    usageBar.classList.toggle("full", percent >= 95);
    usageLabel.textContent = `${formatBytes(used)} von ${formatBytes(max)} belegt`;
}

function renderFiles(files) {
    fileTableBody.innerHTML = "";

    if (!files.length) {
        emptyState.classList.remove("hidden");
        emptyState.textContent = "Keine Dateien gespeichert.";
        return;
    }
    emptyState.classList.add("hidden");

    files.forEach((file) => {
        const tr = document.createElement("tr");

        const nameTd = document.createElement("td");
        nameTd.textContent = file.filename;

        const sizeTd = document.createElement("td");
        sizeTd.textContent = formatBytes(file.size);

        const expiryTd = document.createElement("td");
        expiryTd.textContent = formatDate(file.expiresAt);

        const statusTd = document.createElement("td");
        statusTd.textContent = file.status === "ready" ? "Bereit" : "Ausstehend";

        const actionTd = document.createElement("td");
        const delBtn = document.createElement("button");
        delBtn.textContent = "Löschen";
        delBtn.type = "button";
        delBtn.className = "delete-button";
        delBtn.addEventListener("click", () => deleteFile(file.code, tr));
        actionTd.appendChild(delBtn);

        tr.append(nameTd, sizeTd, expiryTd, statusTd, actionTd);
        fileTableBody.appendChild(tr);
    });
}

async function deleteFile(code, row) {
    if (!confirm("Diese Datei wirklich löschen?")) return;

    row.style.opacity = "0.4";
    try {
        const res = await adminFetch(`/api/admin/files/${code}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Löschen fehlgeschlagen");
        loadFiles(); // Liste + Speicheranzeige direkt neu laden
    } catch (err) {
        if (err.message !== "unauthorized") {
            alert("Löschen fehlgeschlagen.");
            row.style.opacity = "1";
        }
    }
}

refreshButton.addEventListener("click", loadFiles);

// Beim Laden direkt prüfen, ob schon ein Schlüssel für diese Sitzung
// gespeichert ist (sessionStorage -> geht beim Schließen des Tabs verloren)
if (getAdminKey()) {
    showAdmin();
} else {
    showLogin();
}
