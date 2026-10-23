export function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function getErrorMessage(error) {
    if (!error) return "Неизвестная ошибка";
    if (typeof error === "string") return error;
    return error.message || error.error_msg || error.error?.error_msg || error.error_data?.error_msg || String(error);
}

function redactSensitive(value, seen = new WeakSet()) {
    if (value == null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value)) {
        return value.map(item => redactSensitive(item, seen));
    }

    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (/token|access[_-]?token|authorization|secret/i.test(key)) {
            result[key] = "[REDACTED]";
            continue;
        }

        // VK API sometimes returns request_params as [{key, value}].
        if (key === "request_params" && Array.isArray(item)) {
            result[key] = item.map(param => {
                if (!param || typeof param !== "object") return param;
                if (/token|access[_-]?token|authorization|secret/i.test(String(param.key || ""))) {
                    return { ...param, value: "[REDACTED]" };
                }
                return redactSensitive(param, seen);
            });
            continue;
        }

        result[key] = redactSensitive(item, seen);
    }
    return result;
}

export function logError(title, error) {
    console.error(title, getErrorMessage(error));
    try {
        if (error && typeof error === "object") {
            console.error(JSON.stringify(redactSensitive(error), null, 2));
        }
    } catch {}
}

export function renderMessage(container, message, className = "status-message") {
    if (!container) return null;
    container.replaceChildren();
    const block = document.createElement("div");
    block.className = className;
    block.textContent = String(message ?? "");
    container.appendChild(block);
    return block;
}

export function renderError(container, title, error) {
    if (!container) return null;
    container.replaceChildren();
    const block = document.createElement("div");
    block.className = "error";

    const heading = document.createElement("div");
    heading.textContent = String(title || "Произошла ошибка.");
    block.appendChild(heading);

    const details = getErrorMessage(error);
    if (details) {
        const text = document.createElement("div");
        text.className = "error-details";
        text.textContent = details;
        block.appendChild(text);
    }

    container.appendChild(block);
    return block;
}

export function normalizeSearchText(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/[\u2010-\u2015]/g, "-")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function searchTokens(value = "") {
    return normalizeSearchText(value).split(" ").filter(Boolean);
}

export function matchesAllTokens(text, tokens) {
    if (!tokens?.length) return true;
    const normalized = normalizeSearchText(text);
    return tokens.every(token => normalized.includes(token));
}

export function getBestPhotoUrl(photo) {
    if (!Array.isArray(photo?.sizes)) return "";
    return [...photo.sizes]
        .filter(item => item?.url)
        .sort((a, b) => (Number(b.width || 0) * Number(b.height || 0)) - (Number(a.width || 0) * Number(a.height || 0)))[0]?.url || "";
}

export function getPhotoPreviewUrl(photo, targetSize = 240) {
    if (!Array.isArray(photo?.sizes)) return "";
    const list = [...photo.sizes]
        .filter(item => item?.url)
        .map(item => ({ ...item, maxSide: Math.max(Number(item.width || 0), Number(item.height || 0)) }))
        .sort((a, b) => a.maxSide - b.maxSide);
    if (!list.length) return "";
    return (list.find(item => item.maxSide >= targetSize) || list[list.length - 1]).url || "";
}

export function getAlbumCover(album) {
    const sizes = [
        ...(Array.isArray(album?.sizes) ? album.sizes : []),
        ...(Array.isArray(album?.thumb?.sizes) ? album.thumb.sizes : [])
    ].filter(item => item && (item.url || item.src));

    if (sizes.length) {
        const sorted = sizes.sort((a, b) => Math.max(Number(a.width || 0), Number(a.height || 0)) - Math.max(Number(b.width || 0), Number(b.height || 0)));
        const selected = sorted.find(item => Math.max(Number(item.width || 0), Number(item.height || 0)) >= 220) || sorted[sorted.length - 1];
        return selected?.url || selected?.src || "";
    }

    return album?.thumb_src || "";
}

export function formatPhotoDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return "";
    return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export async function copyText(value) {
    const text = String(value || "");
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
}
