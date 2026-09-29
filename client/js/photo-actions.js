import { state } from "./state.js?v=20260929-client10-whitelist";
import { getBestPhotoUrl, copyText } from "./helpers.js?v=20260929-client10-whitelist";
import { openVkPhoto } from "./vk-links.js?v=20260929-client10-whitelist";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260929-client10-whitelist";
import { armLongPressReleaseGuard, consumeLongPressSyntheticClick } from "./long-press-guard.js?v=20260929-client10-whitelist";

const LONG_PRESS_MS = 900;
const MOVE_CANCEL_PX = 15;
const DOWNLOAD_TIMEOUT_SECONDS = 20;
const DOWNLOAD_OVERLAY_ID = "client-download-wait";

let contextOverlay = null;
let downloadOverlay = null;
let activeDownload = null;

export function photoLink(photo) {
    const ownerId = Number(photo?.owner_id || state.ownerId || 0);
    const photoId = Number(photo?.id || 0);
    return ownerId && photoId ? `https://vk.com/photo${ownerId}_${photoId}` : "";
}

export async function copyPhotoLink(photo) {
    const link = photoLink(photo);
    if (!link) throw new Error("Не удалось сформировать ссылку на фотографию.");
    await copyText(link);
    return link;
}

export function openPhotoComments(photo) {
    return openVkPhoto(photo, state.ownerId);
}

function browserDownload(photo) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки для скачивания.");

    const link = document.createElement("a");
    link.href = url;
    link.download = `vk-photo-${Number(photo?.id || Date.now())}.jpg`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function removeDownloadOverlayDirect() {
    downloadOverlay?.remove();
    downloadOverlay = null;
}

function cancelActiveDownload(reason = "cancelled") {
    if (!activeDownload || activeDownload.done) return;
    activeDownload.done = true;
    activeDownload.reason = reason;
    activeDownload.resolve?.({ type: reason });
}

function closeDownloadOverlayDirect() {
    cancelActiveDownload("cancelled");
    removeDownloadOverlayDirect();
}

async function closeDownloadOverlay() {
    if (!downloadOverlay) return false;
    const closed = await closeSwipeOverlay(DOWNLOAD_OVERLAY_ID);
    if (!closed) removeDownloadOverlayDirect();
    return true;
}

function createDownloadOverlay(seconds) {
    removeDownloadOverlayDirect();

    const overlay = document.createElement("div");
    overlay.className = "album-context-overlay client-download-overlay";

    const box = document.createElement("div");
    box.className = "album-context-menu client-download-box";

    const title = document.createElement("div");
    title.className = "client-download-title";
    title.textContent = "Подготавливаем фотографию…";

    const status = document.createElement("div");
    status.className = "client-download-status";
    status.textContent = `Ожидание ответа VK: ${seconds} с`;

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "album-context-item client-download-cancel";
    cancel.textContent = "Отменить";
    cancel.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        cancelActiveDownload("cancelled");
        await closeDownloadOverlay();
    });

    box.append(title, status, cancel);
    overlay.appendChild(box);
    box.addEventListener("click", event => event.stopPropagation());
    overlay.addEventListener("click", event => {
        if (event.target === overlay) {
            cancelActiveDownload("cancelled");
            void closeDownloadOverlay();
        }
    });

    document.body.appendChild(overlay);
    downloadOverlay = overlay;
    openSwipeOverlay(DOWNLOAD_OVERLAY_ID, closeDownloadOverlayDirect);
    return status;
}

export async function downloadPhoto(photo) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки на оригинал.");

    if (!window.vkBridge?.send) {
        browserDownload(photo);
        return true;
    }

    let seconds = DOWNLOAD_TIMEOUT_SECONDS;
    const status = createDownloadOverlay(seconds);

    let interval = 0;
    let timeout = 0;

    const completion = new Promise(resolve => {
        activeDownload = { done: false, resolve, reason: "" };

        interval = window.setInterval(() => {
            seconds = Math.max(0, seconds - 1);
            if (status?.isConnected) status.textContent = `Ожидание ответа VK: ${seconds} с`;
        }, 1000);

        timeout = window.setTimeout(() => {
            if (!activeDownload?.done) {
                activeDownload.done = true;
                resolve({ type: "timeout" });
            }
        }, DOWNLOAD_TIMEOUT_SECONDS * 1000);

        Promise.resolve(window.vkBridge.send("VKWebAppDownloadFile", {
            url,
            filename: `vk-photo-${Number(photo?.id || Date.now())}.jpg`
        })).then(result => {
            if (!activeDownload || activeDownload.done) return;
            activeDownload.done = true;
            resolve({ type: "bridge", result });
        }).catch(error => {
            if (!activeDownload || activeDownload.done) return;
            activeDownload.done = true;
            resolve({ type: "error", error });
        });
    });

    const outcome = await completion;
    window.clearInterval(interval);
    window.clearTimeout(timeout);
    activeDownload = null;
    await closeDownloadOverlay();

    if (outcome.type === "cancelled") return false;
    if (outcome.type === "timeout") {
        alert("VK не ответил на подготовку фотографии за 20 секунд. Попробуйте ещё раз.");
        return false;
    }
    if (outcome.type === "bridge") {
        if (outcome.result?.result === true || outcome.result === true) return true;
        // Если Bridge ответил, но скачивание не подтвердил, пробуем браузерный путь.
        browserDownload(photo);
        return true;
    }

    console.warn("VKWebAppDownloadFile завершился ошибкой, используем браузер:", outcome.error);
    browserDownload(photo);
    return true;
}

function closeContextDirect() {
    contextOverlay?.remove();
    contextOverlay = null;
}

async function closeContext() {
    if (!contextOverlay) return;
    const closed = await closeSwipeOverlay("client-photo-context");
    if (!closed) closeContextDirect();
}

function menuItem(label, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-context-item";
    button.textContent = label;
    button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        const photo = contextOverlay?.__photo;
        await closeContext();
        if (photo) await action(photo);
    });
    return button;
}

export function openPhotoContextMenu(photo) {
    if (!photo?.id) return;
    closeContextDirect();

    const overlay = document.createElement("div");
    overlay.className = "album-context-overlay client-photo-context-overlay";
    overlay.__photo = photo;

    const menu = document.createElement("div");
    menu.className = "album-context-menu client-photo-context-menu";
    menu.append(
        menuItem("Скачать фото", p => downloadPhoto(p)),
        menuItem("Скопировать ссылку", p => copyPhotoLink(p)),
        menuItem("Перейти к комментариям", p => openPhotoComments(p)),
        menuItem("Отмена", async () => {})
    );

    overlay.appendChild(menu);
    menu.addEventListener("click", event => event.stopPropagation());
    overlay.addEventListener("click", event => {
        if (consumeLongPressSyntheticClick(event)) return;
        if (event.target === overlay) void closeContext();
    }, true);

    document.body.appendChild(overlay);
    contextOverlay = overlay;
    openSwipeOverlay("client-photo-context", closeContextDirect);
}

export function bindPhotoLongPress(element, photo) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let triggered = false;
    let pointerId = null;

    const clear = () => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };

    const trigger = () => {
        clear();
        if (triggered) return;
        triggered = true;
        armLongPressReleaseGuard(pointerId);
        state.suppressPhotoOpenUntil = Date.now() + 1200;
        openPhotoContextMenu(photo);
        try { navigator.vibrate?.(18); } catch {}
    };

    element.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        triggered = false;
        pointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;
        clear();
        timer = window.setTimeout(trigger, LONG_PRESS_MS);
    }, { passive: true });

    element.addEventListener("pointermove", event => {
        if (timer === null) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) clear();
    }, { passive: true });

    element.addEventListener("pointerup", clear, { passive: true });
    element.addEventListener("pointercancel", clear, { passive: true });

    element.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        trigger();
    });

    element.addEventListener("click", event => {
        if (!triggered && Date.now() >= Number(state.suppressPhotoOpenUntil || 0)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        triggered = false;
    }, true);
}
