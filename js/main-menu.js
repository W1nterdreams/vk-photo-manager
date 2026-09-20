import { dom } from "./dom.js?v=20260920-uploadsafe01";

function isAlbumOpen() {
    // Определяем экран по реально видимому DOM, а не по состоянию/history.
    // Это не вмешивается в навигацию и одинаково работает после обычного
    // открытия альбома и возврата через history.
    return Boolean(
        dom.photosScreen &&
        !dom.photosScreen.classList.contains("hidden")
    );
}

function setMenuItemVisible(element, visible) {
    if (!element) return;

    element.classList.toggle("hidden", !visible);
    element.hidden = !visible;

    if (visible) {
        element.removeAttribute("hidden");
        element.style.setProperty("display", "flex", "important");
    } else {
        element.style.setProperty("display", "none", "important");
    }
}

export function syncMainMenu() {
    const inAlbum = isAlbumOpen();

    // Главный экран: создать альбом + общие комментарии.
    setMenuItemVisible(dom.createAlbumMenuButton, !inAlbum);
    setMenuItemVisible(dom.commentsMenuButton, !inAlbum);

    // Открытый альбом: только загрузить фото.
    setMenuItemVisible(dom.uploadPhotoMenuButton, inAlbum);
}

export function openMenu() {
    if (!dom.mainMenu) return;

    // Состав меню вычисляем непосредственно в момент нажатия на кнопку.
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

    dom.menuButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const closed =
            dom.mainMenu.classList.contains("hidden") ||
            dom.mainMenu.hidden ||
            getComputedStyle(dom.mainMenu).display === "none";

        if (closed) {
            openMenu();
        } else {
            closeMenu();
        }
    });

    dom.mainMenu?.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("click", event => {
        if (dom.menuButton?.contains(event.target) || dom.mainMenu?.contains(event.target)) return;
        closeMenu();
    });
}
