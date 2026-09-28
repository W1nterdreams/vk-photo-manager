import { state } from "./state.js?v=20260928-client02";
import { dom } from "./dom.js?v=20260928-client02";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260928-client02";
import { openGlobalSearch } from "./global-photo-search.js?v=20260928-client02";
import { downloadPhoto, copyPhotoLink, openPhotoComments } from "./photo-actions.js?v=20260928-client02";

let initialized = false;

function setVisible(element, visible) {
    if (!element) return;
    element.classList.toggle("hidden", !visible);
    element.hidden = !visible;
    if (visible) element.removeAttribute("hidden");
}

export function syncMainMenu() {
    const onPhoto = state.currentScreen === "photo";
    const canSearch = state.currentScreen === "albums" || state.currentScreen === "photos";

    setVisible(dom.globalPhotoSearchMenuButton, canSearch);
    setVisible(dom.downloadPhotoMenuButton, onPhoto);
    setVisible(dom.copyPhotoLinkMenuButton, onPhoto);
    setVisible(dom.openPhotoCommentsMenuButton, onPhoto);
}

function hideDirect() {
    dom.mainMenu?.classList.add("hidden");
    if (dom.mainMenu) dom.mainMenu.hidden = true;
}

export function openMenu() {
    if (!dom.mainMenu) return;
    syncMainMenu();
    dom.mainMenu.classList.remove("hidden");
    dom.mainMenu.hidden = false;
    dom.mainMenu.removeAttribute("hidden");

    Object.assign(dom.mainMenu.style, {
        display: "block",
        position: "fixed",
        top: "62px",
        left: "8px",
        width: "250px",
        zIndex: "2147483647",
        visibility: "visible",
        opacity: "1",
        transform: "none"
    });

    openSwipeOverlay("client-main-menu", hideDirect);
}

export function closeMenu() {
    if (!dom.mainMenu || dom.mainMenu.classList.contains("hidden")) return Promise.resolve(false);
    return closeSwipeOverlay("client-main-menu");
}

export function initMainMenu() {
    if (initialized) return;
    initialized = true;

    if (dom.mainMenu && dom.mainMenu.parentElement !== document.body) {
        document.body.appendChild(dom.mainMenu);
    }

    dom.menuButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (dom.mainMenu.classList.contains("hidden") || dom.mainMenu.hidden) openMenu();
        else void closeMenu();
    });

    dom.globalPhotoSearchMenuButton?.addEventListener("click", async () => {
        await closeMenu();
        void openGlobalSearch();
    });

    dom.downloadPhotoMenuButton?.addEventListener("click", async () => {
        const photo = state.currentPhoto;
        await closeMenu();
        if (!photo) return;
        try { await downloadPhoto(photo); }
        catch (error) { alert(`Не удалось скачать фотографию.\n\n${error?.message || error}`); }
    });

    dom.copyPhotoLinkMenuButton?.addEventListener("click", async () => {
        const photo = state.currentPhoto;
        await closeMenu();
        if (!photo) return;
        try { await copyPhotoLink(photo); }
        catch (error) { alert(`Не удалось скопировать ссылку.\n\n${error?.message || error}`); }
    });

    dom.openPhotoCommentsMenuButton?.addEventListener("click", async () => {
        const photo = state.currentPhoto;
        await closeMenu();
        if (photo) openPhotoComments(photo);
    });

    window.addEventListener("client-screen-changed", syncMainMenu);
}
