import { dom } from "./dom.js?v=20260921-photoindex20";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20260921-photoindex20";
import { initGroupContext } from "./group-context.js?v=20260921-photoindex20";
import { initAlbums, loadAlbums } from "./albums.js?v=20260921-photoindex20";
import { openAlbum } from "./photos.js?v=20260921-photoindex20";
import { initMainMenu } from "./main-menu.js?v=20260921-photoindex20";
import { initAlbumCreate } from "./album-create.js?v=20260921-photoindex20";
import { initAlbumEdit } from "./album-edit.js?v=20260921-photoindex20";
import { initAlbumDelete } from "./album-delete.js?v=20260921-photoindex20";
import { initAlbumReorder } from "./album-reorder.js?v=20260921-photoindex20";
import { initComments } from "./comments.js?v=20260921-photoindex20";
import { initAlbumComments } from "./album-comments.js?v=20260921-photoindex20";
import { initPhotoViewer, openPhotoViewer } from "./photo-viewer.js?v=20260921-photoindex20";
import { initPhotoUpload } from "./photo-upload.js?v=20260921-photoindex20";
import { initPhotoMenu } from "./photo-menu.js?v=20260921-photoindex20";
import { initPhotoTransfer } from "./photo-transfer.js?v=20260921-photoindex20";
import { initPhotoReorder } from "./photo-reorder.js?v=20260921-photoindex20";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20260921-photoindex20";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js?v=20260921-photoindex20";
import { cleanupLegacyCache } from "./cache.js?v=20260921-photoindex20";
import { initGlobalPhotoSearch } from "./global-photo-search.js?v=20260921-photoindex20";
import { initPhotoIndexSync } from "./photo-index-sync.js?v=20260921-photoindex20";

async function startApp() {
    console.log("Starting VK Photo Manager in GROUP ADMIN mode...");

    // Новая схема кэша: удаляем старые частичные индексы и устаревшие
    // данные прошлых сборок до первого чтения localStorage.
    cleanupLegacyCache();

    try {
        initMainMenu();
        initNavigation({
            onOpenAlbumFromHistory: openAlbum,
            onOpenPhotoFromHistory: openPhotoViewer
        });
        initAlbums();
        initAlbumCreate();
        initAlbumEdit();
        initAlbumDelete();
        initAlbumReorder();
        initComments();
        initAlbumComments();
        initPhotoViewer();
        initPhotoUpload();
        initPhotoTransfer();
        initPhotoReorder();
        initPhotoMenu();
        initPhotoIndexSync();
        initGlobalPhotoSearch();

        await vkInit();
        await loadUser();
        await getAccessToken();

        await initGroupContext();
        await loadAlbums();
        showAlbumsScreen();

        // Глобальный фотоиндекс обслуживается лениво: запуск приложения не делает
        // никаких API-запросов ради глобального поиска. Persistent dirty-метки
        // будут обработаны только когда пользователь реально откроет поиск.

        console.log("VK Photo Manager started in group mode.");
    } catch (error) {
        logError("Application startup error:", error);

        dom.albums.innerHTML = `
            <div class="error">
                <b>Ошибка запуска приложения</b>
                <br><br>
                ${escapeHtml(getErrorMessage(error))}
            </div>
        `;
    }
}

startApp();
