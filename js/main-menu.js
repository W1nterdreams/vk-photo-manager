import { dom } from "./dom.js?v=20260920-albumtools02";
import { state } from "./state.js?v=20260920-albumtools02";
import { getOwnerId } from "./group-context.js?v=20260920-albumtools02";
import { setPhotoDateSort, getPhotoDateSort } from "./photos.js?v=20260920-albumtools02";

let sortOverlay = null;

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

function albumLink(album) {
    if (!album?.id) return "";
    const ownerId = Number(album.owner_id) || getOwnerId();
    return `https://vk.com/album${ownerId}_${album.id}`;
}

async function copyText(text) {
    if (!text) return;

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

function emitAlbumAction(action) {
    const album = state.currentAlbum;
    if (!album) return;

    window.dispatchEvent(new CustomEvent("album-menu-action", {
        detail: { action, album }
    }));
}

function closeSortMenu() {
    if (!sortOverlay) return;
    sortOverlay.classList.add("hidden");
    document.body.classList.remove("album-menu-open");
}

function createSortItem(label, mode) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "album-context-item";
    button.dataset.sortMode = mode;
    button.textContent = label;

    button.addEventListener("click", () => {
        setPhotoDateSort(mode);
        closeSortMenu();
    });

    return button;
}

function syncSortSelection() {
    if (!sortOverlay) return;
    const current = getPhotoDateSort();

    sortOverlay.querySelectorAll("[data-sort-mode]").forEach(button => {
        const active = button.dataset.sortMode === current;
        button.classList.toggle("selected", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function ensureSortMenu() {
    if (sortOverlay) return;

    sortOverlay = document.createElement("div");
    sortOverlay.className = "album-context-overlay hidden";
    sortOverlay.id = "albumDateSortOverlay";

    const menu = document.createElement("div");
    menu.className = "album-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Сортировка фотографий");

    menu.append(
        createSortItem("Сначала новые", "newest"),
        createSortItem("Сначала старые", "oldest"),
        createSortItem("Порядок VK", "vk")
    );

    sortOverlay.appendChild(menu);
    document.body.appendChild(sortOverlay);

    sortOverlay.addEventListener("click", event => {
        if (event.target === sortOverlay) closeSortMenu();
    });

    menu.addEventListener("click", event => event.stopPropagation());
}

function openSortMenu() {
    closeMenu();
    if (!state.currentAlbum || state.currentScreen !== "photos") return;

    ensureSortMenu();
    syncSortSelection();
    sortOverlay.classList.remove("hidden");
    document.body.classList.add("album-menu-open");
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
    setMenuItemVisible(dom.sortAlbumByDateMenuButton, inAlbum);
    setMenuItemVisible(dom.copyAlbumLinkMenuButton, inAlbum);
    setMenuItemVisible(dom.editAlbumMenuButton, inAlbum);

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

    dom.sortAlbumByDateMenuButton?.addEventListener("click", openSortMenu);

    dom.copyAlbumLinkMenuButton?.addEventListener("click", async () => {
        const album = state.currentAlbum;
        closeMenu();
        if (!album) return;

        try {
            await copyText(albumLink(album));
        } catch (error) {
            console.warn("Не удалось скопировать ссылку на альбом:", error);
        }
    });

    dom.editAlbumMenuButton?.addEventListener("click", () => {
        closeMenu();
        emitAlbumAction("edit");
    });

    dom.mainMenu?.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("click", event => {
        if (dom.menuButton?.contains(event.target) || dom.mainMenu?.contains(event.target)) return;
        closeMenu();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape") closeSortMenu();
    });
}
