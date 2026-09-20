import { state } from "./state.js?v=20260920-albumtools15";
import {
    downloadPhotoFile,
    openPhotoDescriptionEditor,
    deletePhoto
} from "./photo-menu.js?v=20260920-albumtools15";
import { openPhotoTransfer } from "./photo-transfer.js?v=20260920-albumtools15";
import { openPhotoReorder } from "./photo-reorder.js?v=20260920-albumtools15";
import { getErrorMessage } from "./helpers.js?v=20260920-albumtools15";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260920-albumtools15";
import {
    isPhotoMultiSelectActive,
    startPhotoMultiSelect
} from "./photo-multiselect.js?v=20260920-albumtools15";

const LONG_PRESS_MS = 520;
const MOVE_CANCEL_PX = 12;

let overlay = null;
let menu = null;
let currentPhoto = null;

function createItem(label, action, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `album-context-item ${extraClass}`.trim();
    button.textContent = label;

    button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const photo = currentPhoto;
        await closePhotoContextMenu();
        if (!photo) return;

        try {
            if (action === "download") {
                await downloadPhotoFile(photo);
                return;
            }

            if (action === "edit") {
                openPhotoDescriptionEditor(photo);
                return;
            }

            if (action === "copy") {
                void openPhotoTransfer(photo, "copy");
                return;
            }

            if (action === "move") {
                void openPhotoTransfer(photo, "move");
                return;
            }

            if (action === "reorder") {
                void openPhotoReorder(photo);
                return;
            }

            if (action === "select-many") {
                startPhotoMultiSelect(photo);
                return;
            }

            if (action === "delete") {
                await deletePhoto(photo, { returnFromViewer: false });
            }
        } catch (error) {
            alert(`Не удалось выполнить действие.\n\n${getErrorMessage(error)}`);
        }
    });

    return button;
}

function ensureMenu() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "album-context-overlay hidden";
    overlay.id = "photoContextOverlay";

    menu = document.createElement("div");
    menu.className = "album-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Действия с фотографией");

    menu.append(
        createItem("Скачать фото", "download"),
        createItem("Изменить описание", "edit"),
        createItem("Копировать в альбом", "copy"),
        createItem("Переместить в альбом", "move"),
        createItem("Переместить внутри альбома", "reorder"),
        createItem("Выбрать несколько", "select-many"),
        createItem("Удалить фото", "delete", "danger")
    );

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
        if (event.target === overlay) void closePhotoContextMenu();
    });

    menu.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
            void closePhotoContextMenu();
        }
    });
}

function hidePhotoContextMenuDirect() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.classList.remove("album-menu-open");
    currentPhoto = null;
}

export function openPhotoContextMenu(photo) {
    if (!photo?.id) return;
    ensureMenu();
    currentPhoto = photo;
    state.suppressPhotoOpenUntil = Date.now() + 1200;
    overlay.classList.remove("hidden");
    document.body.classList.add("album-menu-open");
    openSwipeOverlay("photo-context-menu", hidePhotoContextMenuDirect);
}

export function closePhotoContextMenu() {
    if (!overlay || overlay.classList.contains("hidden")) {
        return Promise.resolve(false);
    }
    return closeSwipeOverlay("photo-context-menu");
}

export function bindPhotoContextLongPress(element, photo) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longPressTriggered = false;

    const clearTimer = () => {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
    };

    const trigger = () => {
        clearTimer();
        if (longPressTriggered) return;
        longPressTriggered = true;
        state.suppressPhotoOpenUntil = Date.now() + 1200;
        openPhotoContextMenu(photo);
        try { navigator.vibrate?.(18); } catch {}
    };

    element.addEventListener("pointerdown", event => {
        if (isPhotoMultiSelectActive()) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;

        clearTimer();
        longPressTriggered = false;
        startX = event.clientX;
        startY = event.clientY;

        timer = window.setTimeout(trigger, LONG_PRESS_MS);
    }, { passive: true });

    element.addEventListener("pointermove", event => {
        if (timer === null) return;
        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer();
    }, { passive: true });

    element.addEventListener("pointerup", clearTimer, { passive: true });
    element.addEventListener("pointercancel", clearTimer, { passive: true });
    element.addEventListener("pointerleave", event => {
        if (event.pointerType === "mouse") clearTimer();
    });

    element.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        if (isPhotoMultiSelectActive()) return;
        trigger();
    });

    // Важно: capture-обработчик срабатывает раньше обычного click на карточке.
    // После long press браузер/WebView часто генерирует дополнительный click.
    element.addEventListener("click", event => {
        if (!longPressTriggered && Date.now() >= Number(state.suppressPhotoOpenUntil || 0)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        longPressTriggered = false;
    }, true);
}
