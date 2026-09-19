import { state } from "./state.js?v=20260919-nav01";
import { dom } from "./dom.js?v=20260919-nav01";

let openAlbumFromHistory = null;
let navigationInitialized = false;

function hideScreens() {
    dom.albumsScreen.classList.add("hidden");
    dom.photosScreen.classList.add("hidden");
    dom.commentsScreen.classList.add("hidden");
}

function setScrollLater(y = 0) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.scrollTo(0, Number(y) || 0);
        });
    });
}

export function showAlbumsScreen({ restoreScroll = 0 } = {}) {
    hideScreens();
    dom.albumsScreen.classList.remove("hidden");

    state.currentScreen = "albums";
    state.currentAlbum = null;

    dom.pageTitle.textContent = "Фотоальбомы";
    dom.backButton.classList.add("hidden");
    dom.refreshAlbums.classList.remove("hidden");

    setScrollLater(restoreScroll);
}

export function showPhotosScreen({ restoreScroll = 0 } = {}) {
    hideScreens();
    dom.photosScreen.classList.remove("hidden");

    state.currentScreen = "photos";

    dom.backButton.classList.remove("hidden");
    dom.refreshAlbums.classList.add("hidden");

    setScrollLater(restoreScroll);
}

export function showCommentsScreen({ restoreScroll = 0 } = {}) {
    hideScreens();
    dom.commentsScreen.classList.remove("hidden");

    state.currentScreen = "comments";

    dom.pageTitle.textContent = "Комментарии";
    dom.backButton.classList.remove("hidden");
    dom.refreshAlbums.classList.add("hidden");

    setScrollLater(restoreScroll);
}

function saveCurrentScrollToHistory() {
    const current = history.state || {};

    if (current.screen === "albums" || state.currentScreen === "albums") {
        history.replaceState(
            {
                ...current,
                screen: "albums",
                scrollY: window.scrollY
            },
            "",
            window.location.href
        );
    }
}

export function pushAlbumHistory(album) {
    saveCurrentScrollToHistory();

    history.pushState(
        {
            screen: "photos",
            albumId: String(album.id),
            scrollY: 0
        },
        "",
        `#album-${album.id}`
    );
}

export function pushCommentsHistory() {
    saveCurrentScrollToHistory();

    history.pushState(
        {
            screen: "comments",
            scrollY: 0
        },
        "",
        "#comments"
    );
}

async function handlePopState(event) {
    const navState = event.state;

    if (!navState || navState.screen === "albums") {
        showAlbumsScreen({ restoreScroll: navState?.scrollY || 0 });
        return;
    }

    if (navState.screen === "photos") {
        const albumId = String(navState.albumId || "");
        const album = state.albums.find(item => String(item.id) === albumId);

        if (album && typeof openAlbumFromHistory === "function") {
            await openAlbumFromHistory(album, {
                fromHistory: true,
                restoreScroll: navState.scrollY || 0
            });
            return;
        }

        // Если альбом не найден в уже загруженной странице,
        // безопасно возвращаемся к списку альбомов.
        showAlbumsScreen();
        return;
    }

    if (navState.screen === "comments") {
        showCommentsScreen({ restoreScroll: navState.scrollY || 0 });
        return;
    }

    showAlbumsScreen();
}

export function initNavigation({ onOpenAlbumFromHistory } = {}) {
    if (navigationInitialized) return;
    navigationInitialized = true;

    openAlbumFromHistory = onOpenAlbumFromHistory || null;

    history.replaceState(
        {
            screen: "albums",
            scrollY: window.scrollY || 0
        },
        "",
        window.location.href
    );

    window.addEventListener("popstate", event => {
        void handlePopState(event);
    });

    dom.backButton.addEventListener("click", () => {
        if (state.currentScreen === "albums") return;
        history.back();
    });
}

export async function enableVkHistorySwipe() {
    try {
        if (!window.vkBridge?.send) return;

        await window.vkBridge.send("VKWebAppSetSwipeSettings", {
            history: true
        });
    } catch (error) {
        // В обычном браузере или на клиентах без поддержки метода
        // History API продолжит работать сам по себе.
        console.debug("VK swipe history is unavailable:", error);
    }
}
