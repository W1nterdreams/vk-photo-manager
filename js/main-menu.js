import { dom } from "./dom.js?v=20260920-uploadmenu02";
import { state } from "./state.js?v=20260920-uploadmenu02";

function setVisible(element, visible) {
    if (!element) return;
    element.classList.toggle("hidden", !visible);
    element.hidden = !visible;
}

function isAlbumScreenVisible() {
    return Boolean(
        dom.photosScreen &&
        !dom.photosScreen.classList.contains("hidden")
    );
}

export function syncMainMenu() {
    // Не полагаемся только на state.currentScreen: в WebView экран может
    // успеть перерисоваться раньше/позже состояния. Сверяем и состояние,
    // и реально видимый экран альбома.
    const inAlbum = Boolean(state.currentAlbum) && (
        state.currentScreen === "photos" ||
        isAlbumScreenVisible()
    );

    setVisible(dom.createAlbumMenuButton, !inAlbum);
    setVisible(dom.commentsMenuButton, !inAlbum);
    setVisible(dom.uploadPhotoMenuButton, inAlbum);
}

export function openMenu() {
    if (!dom.mainMenu) return;

    // Каждый раз перед открытием пересобираем состав меню под текущий экран.
    syncMainMenu();

    dom.mainMenu.classList.remove("hidden");
    dom.mainMenu.hidden = false;
    dom.mainMenu.removeAttribute("hidden");
    Object.assign(dom.mainMenu.style, {
        display: "block",
        position: "fixed",
        top: "62px",
        left: "8px",
        width: "240px",
        zIndex: "2147483647",
        visibility: "visible",
        opacity: "1",
        transform: "none",
        background: "#24272a",
        color: "#fff"
    });
}

export function closeMenu() {
    if (!dom.mainMenu) return;
    dom.mainMenu.classList.add("hidden");
    dom.mainMenu.hidden = true;
    dom.mainMenu.style.removeProperty("display");
}

export function initMainMenu() {
    if (dom.mainMenu && dom.mainMenu.parentElement !== document.body) {
        document.body.appendChild(dom.mainMenu);
    }

    syncMainMenu();

    dom.menuButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const closed =
            dom.mainMenu.classList.contains("hidden") ||
            dom.mainMenu.hidden ||
            getComputedStyle(dom.mainMenu).display === "none";

        closed ? openMenu() : closeMenu();
    });

    dom.mainMenu?.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("click", event => {
        if (dom.menuButton?.contains(event.target) || dom.mainMenu?.contains(event.target)) return;
        closeMenu();
    });
}
