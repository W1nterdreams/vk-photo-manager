import { state } from "./state.js?v=20260928-client06-memorysearch";
import { dom } from "./dom.js?v=20260928-client06-memorysearch";
import { handleOverlayPopState } from "./overlay-history.js?v=20260928-client06-memorysearch";

let initialized = false;
let openAlbumFromHistory = null;
let openPhotoFromHistory = null;

function setSwipeHistory(enabled) {
    try {
        Promise.resolve(window.vkBridge?.send?.("VKWebAppSetSwipeSettings", { history: Boolean(enabled) }))
            .catch(() => {});
    } catch {}
}

function hideAllScreens() {
    dom.albumsScreen?.classList.add("hidden");
    dom.photosScreen?.classList.add("hidden");
    dom.photoViewerScreen?.classList.add("hidden");
}

function setCommonUi({ title, showBack, showSort = false, showRefresh = true }) {
    if (dom.pageTitle) dom.pageTitle.textContent = title;
    dom.backButton?.classList.toggle("hidden", !showBack);
    dom.albumSortControls?.classList.toggle("hidden", !showSort);
    dom.refreshButton?.classList.toggle("hidden", !showRefresh);
    setSwipeHistory(showBack);
}

export function showAlbumsScreen({ restoreScroll = 0 } = {}) {
    hideAllScreens();
    dom.albumsScreen?.classList.remove("hidden");
    state.currentScreen = "albums";
    setCommonUi({ title: "Фотоальбомы", showBack: false, showRefresh: true });
    requestAnimationFrame(() => window.scrollTo(0, Number(restoreScroll) || 0));
}

export function showPhotosScreen({ restoreScroll = 0 } = {}) {
    hideAllScreens();
    dom.photosScreen?.classList.remove("hidden");
    state.currentScreen = "photos";
    setCommonUi({ title: state.currentAlbum?.title || "Альбом", showBack: true, showSort: true, showRefresh: true });
    requestAnimationFrame(() => window.scrollTo(0, Number(restoreScroll) || 0));
}

export function showPhotoViewerScreen() {
    hideAllScreens();
    dom.photoViewerScreen?.classList.remove("hidden");
    state.currentScreen = "photo";
    setCommonUi({ title: "Фотография", showBack: true, showRefresh: false });
    window.scrollTo(0, 0);
}

function currentScroll() {
    return Number(window.scrollY || 0);
}

export function saveCurrentScrollToHistory() {
    const current = history.state;
    if (!current) return;
    history.replaceState({ ...current, scrollY: currentScroll() }, "", window.location.href);
}

export function pushAlbumHistory(album) {
    saveCurrentScrollToHistory();
    history.pushState({ screen: "photos", albumId: String(album.id), scrollY: 0 }, "", `#album-${album.id}`);
}

export function pushPhotoHistory(photo, album, { viewerSource = "" } = {}) {
    saveCurrentScrollToHistory();
    history.pushState({
        screen: "photo",
        albumId: String(album?.id ?? photo?.album_id ?? ""),
        photoId: String(photo?.id || ""),
        viewerSource: String(viewerSource || ""),
        scrollY: 0
    }, "", `#photo-${photo?.id || ""}`);
}

export function replacePhotoHistory(photo, album, { viewerSource = "" } = {}) {
    const current = history.state || {};
    history.replaceState({
        ...current,
        screen: "photo",
        albumId: String(album?.id ?? photo?.album_id ?? ""),
        photoId: String(photo?.id || ""),
        viewerSource: String(viewerSource || current.viewerSource || ""),
        scrollY: 0
    }, "", `#photo-${photo?.id || ""}`);
}

function findAlbum(id) {
    const key = String(id || "");
    return state.albums.find(album => String(album.id) === key) ||
        (state.currentAlbum && String(state.currentAlbum.id) === key ? state.currentAlbum : null);
}

async function handlePopState(event) {
    if (handleOverlayPopState()) return;

    const nav = event.state;
    if (!nav || nav.screen === "albums") {
        showAlbumsScreen({ restoreScroll: nav?.scrollY || 0 });
        return;
    }

    if (nav.screen === "photos") {
        const album = findAlbum(nav.albumId);
        if (album && openAlbumFromHistory) {
            await openAlbumFromHistory(album, { fromHistory: true, restoreScroll: nav.scrollY || 0 });
            return;
        }
        showAlbumsScreen();
        return;
    }

    if (nav.screen === "photo") {
        const album = findAlbum(nav.albumId) || { id: Number(nav.albumId || 0), owner_id: state.ownerId, title: "Альбом" };
        if (openPhotoFromHistory) {
            const id = Number(nav.photoId || 0);
            const photo = state.viewerSequence.find(item => Number(item?.id || 0) === id) ||
                state.photos.find(item => Number(item?.id || 0) === id) ||
                (state.currentPhoto && Number(state.currentPhoto.id) === id ? state.currentPhoto : { id, album_id: Number(album.id), owner_id: state.ownerId });
            await openPhotoFromHistory(photo, album, {
                fromHistory: true,
                viewerSource: String(nav.viewerSource || "")
            });
            return;
        }
        showAlbumsScreen();
        return;
    }

    showAlbumsScreen();
}

export function initNavigation({ onOpenAlbumFromHistory, onOpenPhotoFromHistory } = {}) {
    if (initialized) return;
    initialized = true;
    openAlbumFromHistory = onOpenAlbumFromHistory || null;
    openPhotoFromHistory = onOpenPhotoFromHistory || null;

    history.replaceState({ screen: "albums", scrollY: 0 }, "", window.location.href.split("#")[0]);

    window.addEventListener("popstate", event => { void handlePopState(event); });
    dom.backButton?.addEventListener("click", () => {
        if (state.currentScreen !== "albums") history.back();
    });
}
