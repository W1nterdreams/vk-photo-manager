import { dom } from "./dom.js?v=20260920-photomenu01";

function visible(element) {
    return Boolean(element && !element.classList.contains("hidden"));
}

function currentMenuContext() {
    if (visible(dom.photoViewerScreen)) return "photo";
    if (visible(dom.photosScreen)) return "album";
    return "main";
}

function setMenuItemVisible(element, isVisible) {
    if (!element) return;

    element.classList.toggle("hidden", !isVisible);
    element.hidden = !isVisible;

    if (isVisible) {
        element.removeAttribute("hidden");
        element.style.setProperty("display", "flex", "important");
    } else {
        element.style.setProperty("display", "none", "important");
    }
}

export function syncMainMenu() {
    const context = currentMenuContext();
    const onMain = context === "main";
    const inAlbum = context === "album";
    const onPhoto = context === "photo";

    // Главный экран / экран общих комментариев.
    setMenuItemVisible(dom.createAlbumMenuButton, onMain);
    setMenuItemVisible(dom.commentsMenuButton, onMain);

    // Открытый альбом.
    setMenuItemVisible(dom.uploadPhotoMenuButton, inAlbum);

    // Открытая фотография.
    setMenuItemVisible(dom.downloadPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.editPhotoDescriptionMenuButton, onPhoto);
    setMenuItemVisible(dom.copyPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.movePhotoMenuButton, onPhoto);
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

        if (closed) openMenu();
        else closeMenu();
    });

    dom.mainMenu?.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("click", event => {
        if (dom.menuButton?.contains(event.target) || dom.mainMenu?.contains(event.target)) return;
        closeMenu();
    });
}
