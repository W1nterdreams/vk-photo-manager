import { state } from "./state.js?v=20260929-client08-authfix";
import { dom } from "./dom.js?v=20260929-client08-authfix";
import { loadClientConfig } from "./config.js?v=20260929-client08-authfix";
import { initGroupContext } from "./group-context.js?v=20260929-client08-authfix";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20260929-client08-authfix";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20260929-client08-authfix";
import { initAlbums, loadSearchAlbums } from "./albums.js?v=20260929-client08-authfix";
import { initPhotos, openAlbum, refreshCurrentAlbum } from "./photos.js?v=20260929-client08-authfix";
import { initPhotoViewer, openPhotoViewer } from "./photo-viewer.js?v=20260929-client08-authfix";
import { initGlobalPhotoSearch, refreshGlobalSearch } from "./global-photo-search.js?v=20260929-client08-authfix";
import { searchTokens } from "./helpers.js?v=20260929-client08-authfix";
import { getErrorMessage, logError } from "./helpers.js?v=20260929-client08-authfix";

let hiddenAt = 0;
let refreshing = false;

function showFatalError(error) {
    const message = getErrorMessage(error);
    if (dom.user) dom.user.textContent = "Ошибка";
    if (dom.albums) {
        dom.albums.innerHTML = `
            <div class="error client-fatal-error">
                Не удалось запустить приложение.<br><br>${String(message)
                    .replaceAll("&", "&amp;")
                    .replaceAll("<", "&lt;")
                    .replaceAll(">", "&gt;")}
            </div>`;
    }
}

async function refreshCurrentScreen() {
    if (refreshing) return;
    refreshing = true;
    dom.refreshButton?.classList.add("is-refreshing");

    try {
        if (state.currentScreen === "albums") {
            if (searchTokens(state.globalQuery || "").length) await refreshGlobalSearch();
            else await loadSearchAlbums({ force: true });
            return;
        }
        if (state.currentScreen === "photos") {
            await refreshCurrentAlbum();
        }
    } catch (error) {
        alert(`Не удалось обновить данные.\n\n${getErrorMessage(error)}`);
    } finally {
        refreshing = false;
        dom.refreshButton?.classList.remove("is-refreshing");
    }
}

function initVisibilityFreshness() {
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            hiddenAt = Date.now();
            return;
        }

        const awayMs = hiddenAt ? Date.now() - hiddenAt : 0;
        hiddenAt = 0;
        const threshold = Math.max(5_000, Number(state.config?.album_session_fresh_seconds || 60) * 1000);

        if (awayMs >= threshold && state.currentScreen === "photos" && state.currentAlbum) {
            void refreshCurrentAlbum();
        }
    });
}

async function start() {
    try {
        if (!window.vkBridge?.send) throw new Error("VK Bridge не загружен.");

        state.config = await loadClientConfig();

        await vkInit();
        await loadUser();
        initGroupContext(state.config, state.currentUser);
        await getAccessToken();

        initAlbums({ onOpenAlbum: openAlbum });
        initPhotos({ onOpenPhoto: openPhotoViewer });
        initPhotoViewer();
        initGlobalPhotoSearch({ onOpenPhoto: openPhotoViewer });
        initNavigation({
            onOpenAlbumFromHistory: openAlbum,
            onOpenPhotoFromHistory: openPhotoViewer
        });
        initVisibilityFreshness();

        dom.refreshButton?.addEventListener("click", () => { void refreshCurrentScreen(); });

        showAlbumsScreen();
        await loadSearchAlbums({ force: false });
    } catch (error) {
        logError("Ошибка запуска клиентского приложения:", error);
        showFatalError(error);
    }
}

void start();
