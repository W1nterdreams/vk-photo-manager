import { dom } from "./dom.js?v=20260920-albumtools03";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20260920-albumtools03";
import { initGroupContext } from "./group-context.js?v=20260920-albumtools03";
import { initAlbums, loadAlbums } from "./albums.js?v=20260920-albumtools03";
import { openAlbum } from "./photos.js?v=20260920-albumtools03";
import { initMainMenu } from "./main-menu.js?v=20260920-albumtools03";
import { initAlbumCreate } from "./album-create.js?v=20260920-albumtools03";
import { initAlbumEdit } from "./album-edit.js?v=20260920-albumtools03";
import { initAlbumDelete } from "./album-delete.js?v=20260920-albumtools03";
import { initAlbumReorder } from "./album-reorder.js?v=20260920-albumtools03";
import { initComments } from "./comments.js?v=20260920-albumtools03";
import { initAlbumComments } from "./album-comments.js?v=20260920-albumtools03";
import { initPhotoViewer, openPhotoViewer } from "./photo-viewer.js?v=20260920-albumtools03";
import { initPhotoUpload } from "./photo-upload.js?v=20260920-albumtools03";
import { initPhotoMenu } from "./photo-menu.js?v=20260920-albumtools03";
import { initPhotoTransfer } from "./photo-transfer.js?v=20260920-albumtools03";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20260920-albumtools03";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js?v=20260920-albumtools03";
import { cleanupLegacyCache } from "./cache.js?v=20260920-albumtools03";

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
        initPhotoMenu();

        await vkInit();
        await loadUser();
        await getAccessToken();

        await initGroupContext();
        await loadAlbums();
        showAlbumsScreen();

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
