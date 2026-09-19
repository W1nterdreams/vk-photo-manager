import { dom } from "./dom.js?v=20260919-nav03";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20260919-nav03";
import { initGroupContext } from "./group-context.js?v=20260919-nav03";
import { initAlbums, loadAlbums } from "./albums.js?v=20260919-menu01";
import { openAlbum } from "./photos.js?v=20260919-nav03";
import { initMainMenu } from "./main-menu.js?v=20260919-nav03";
import { initAlbumCreate } from "./album-create.js?v=20260919-nav03";
import { initComments } from "./comments.js?v=20260919-nav03";
import { initAlbumComments } from "./album-comments.js?v=20260919-commentui02";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20260919-nav03";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js?v=20260919-nav03";

async function startApp() {
    console.log("Starting VK Photo Manager in GROUP ADMIN mode...");

    try {
        initMainMenu();
        initNavigation({
            onOpenAlbumFromHistory: openAlbum
        });
        initAlbums();
        initAlbumCreate();
        initComments();
        initAlbumComments();

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
