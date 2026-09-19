import { dom } from "./dom.js";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js";
import { initGroupContext } from "./group-context.js";
import { initAlbums, loadAlbums } from "./albums.js";
import { initMainMenu } from "./main-menu.js";
import { initAlbumCreate } from "./album-create.js";
import { initComments } from "./comments.js";
import { initNavigation, showAlbumsScreen } from "./navigation.js";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js";

async function startApp() {
    console.log("Starting VK Photo Manager in GROUP ADMIN mode...");

    try {
        initMainMenu();
        initNavigation();
        initAlbums();
        initAlbumCreate();
        initComments();

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
