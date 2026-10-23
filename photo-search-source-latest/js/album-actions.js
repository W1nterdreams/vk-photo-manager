import { state } from "./state.js?v=20260929-client12-privacy";
import { copyText } from "./helpers.js?v=20260929-client12-privacy";
import { albumLink, openVkAlbum } from "./vk-links.js?v=20260929-client12-privacy";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260929-client12-privacy";
import { armLongPressReleaseGuard, consumeLongPressSyntheticClick } from "./long-press-guard.js?v=20260929-client12-privacy";

const LONG_PRESS_MS = 900;
const MOVE_CANCEL_PX = 15;
const OVERLAY_ID = "client-album-context";

let contextOverlay = null;

export async function copyAlbumLink(album) {
    const link = albumLink(album, state.ownerId);
    if (!link) throw new Error("Не удалось сформировать ссылку на альбом.");
    await copyText(link);
    return link;
}

export function openAlbumInVk(album) {
    return openVkAlbum(album, state.ownerId);
}

function closeContextDirect() {
    contextOverlay?.remove();
    contextOverlay = null;
}

async function closeContext() {
    if (!contextOverlay) return;
    const closed = await closeSwipeOverlay(OVERLAY_ID);
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
        const album = contextOverlay?.__album;
        await closeContext();
        if (album) await action(album);
    });
    return button;
}

export function openAlbumContextMenu(album) {
    if (!album?.id) return;
    closeContextDirect();

    const overlay = document.createElement("div");
    overlay.className = "album-context-overlay client-album-context-overlay";
    overlay.__album = album;

    const menu = document.createElement("div");
    menu.className = "album-context-menu client-album-context-menu";
    menu.append(
        menuItem("Скопировать ссылку", item => copyAlbumLink(item)),
        menuItem("Открыть альбом в VK", item => openAlbumInVk(item)),
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
    openSwipeOverlay(OVERLAY_ID, closeContextDirect);
}

export function bindAlbumLongPress(element, album) {
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
        state.suppressAlbumOpenUntil = Date.now() + 1200;
        openAlbumContextMenu(album);
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
        if (!triggered && Date.now() >= Number(state.suppressAlbumOpenUntil || 0)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        triggered = false;
    }, true);
}
