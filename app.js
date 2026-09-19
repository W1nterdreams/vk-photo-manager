"use strict";

/*
 * ==========================================
 * VK PHOTO MANAGER
 * ==========================================
 *
 * VK Mini App
 * App ID: 54771516
 *
 * Основные функции:
 * - получение текущего пользователя
 * - получение access token
 * - загрузка альбомов
 * - открытие альбома
 * - загрузка фотографий
 * - отображение фотографий
 *
 * ==========================================
 */


/* ==========================================
   НАСТРОЙКИ
   ========================================== */

const VK_APP_ID = 54771516;
const VK_API_VERSION = "5.199";


/* ==========================================
   ГЛОБАЛЬНОЕ СОСТОЯНИЕ
   ========================================== */

let currentUser = null;

let accessToken = null;

let accessScope = [];

let albums = [];

let currentAlbum = null;

let photos = [];


/* ==========================================
   DOM
   ========================================== */

const userElement =
    document.getElementById("user");

const albumsElement =
    document.getElementById("albums");

const photosElement =
    document.getElementById("photos");

const albumHeaderElement =
    document.getElementById("albumHeader");

const albumTitleElement =
    document.getElementById("albumTitle");

const albumDescriptionElement =
    document.getElementById("albumDescription");

const photoCountElement =
    document.getElementById("photoCount");

const refreshAlbumsButton =
    document.getElementById("refreshAlbums");


/* ==========================================
   ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
   ========================================== */


/*
 * Преобразование любой ошибки VK
 * в нормальный текст.
 */
function getErrorMessage(error) {

    if (!error) {
        return "Неизвестная ошибка";
    }


    if (typeof error === "string") {
        return error;
    }


    if (error.message) {
        return error.message;
    }


    if (error.error_msg) {
        return error.error_msg;
    }


    if (error.error && error.error.error_msg) {
        return error.error.error_msg;
    }


    if (error.params && error.params.error_msg) {
        return error.params.error_msg;
    }


    try {

        return JSON.stringify(
            error,
            null,
            2
        );

    } catch (e) {

        return String(error);

    }
}


/*
 * Красивый вывод ошибки в консоль.
 */
function logError(title, error) {

    console.error(
        title,
        error
    );

    try {

        console.error(
            `${title} JSON:`,
            JSON.stringify(
                error,
                null,
                2
            )
        );

    } catch (e) {

        console.error(
            `${title} JSON:`,
            "Ошибка сериализации"
        );

    }
}


/*
 * Безопасное экранирование HTML.
 */
function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll(
            "&",
            "&amp;"
        )
        .replaceAll(
            "<",
            "&lt;"
        )
        .replaceAll(
            ">",
            "&gt;"
        )
        .replaceAll(
            '"',
            "&quot;"
        )
        .replaceAll(
            "'",
            "&#039;"
        );
}


/*
 * Показ ошибки в интерфейсе.
 */
function showError(message) {

    const html = `
        <div class="error">
            ${escapeHtml(message)}
        </div>
    `;


    if (photosElement) {
        photosElement.innerHTML = html;
    }

}


/* ==========================================
   VK BRIDGE
   ========================================== */

async function vkInit() {

    try {

        console.log(
            "Инициализация VK Bridge..."
        );


        await vkBridge.send(
            "VKWebAppInit"
        );


        console.log(
            "VK Bridge initialized"
        );


        return true;

    } catch (error) {

        logError(
            "VK Bridge initialization error:",
            error
        );


        showError(
            "Не удалось инициализировать VK Bridge."
        );


        return false;
    }
}


/* ==========================================
   ПОЛУЧЕНИЕ ПОЛЬЗОВАТЕЛЯ
   ========================================== */

async function loadUser() {

    try {

        console.log(
            "Получаем данные пользователя..."
        );


        const result =
            await vkBridge.send(
                "VKWebAppGetUserInfo"
            );


        currentUser = result;


        const firstName =
            result.first_name || "";


        const lastName =
            result.last_name || "";


        const fullName =
            `${firstName} ${lastName}`.trim();


        if (userElement) {

            userElement.textContent =
                fullName || "Пользователь";

        }


        console.log(
            "Current user:",
            result
        );


        return result;

    } catch (error) {

        logError(
            "User loading error:",
            error
        );


        if (userElement) {

            userElement.textContent =
                "Пользователь";

        }


        throw error;
    }
}


/* ==========================================
   ПОЛУЧЕНИЕ ACCESS TOKEN
   ========================================== */

/*
 * Для вызова VK API от имени пользователя
 * получаем пользовательский access token.
 *
 * Нам нужен доступ к фотографиям.
 */

async function getAccessToken() {

    try {

        console.log(
            "Запрашиваем access token..."
        );


        const result =
            await vkBridge.send(
                "VKWebAppGetAuthToken",
                {
                    app_id: VK_APP_ID,
                    scope: "photos"
                }
            );


        accessToken =
            result.access_token || null;


        /*
         * VK может вернуть scope строкой:
         *
         * "photos"
         *
         * или:
         *
         * "photos,friends"
         */

        if (typeof result.scope === "string") {

            accessScope =
                result.scope
                    .split(",")
                    .map(
                        value =>
                            value.trim()
                    )
                    .filter(Boolean);

        } else {

            accessScope = [];

        }


        console.log(
            "Access token получен."
        );


        console.log(
            "Granted scopes:",
            accessScope
        );


        /*
         * Сам токен специально не выводим
         * в консоль.
         */


        if (!accessToken) {

            throw new Error(
                "VK не вернул access token."
            );

        }


        return accessToken;

    } catch (error) {

        logError(
            "Access token error:",
            error
        );


        throw error;
    }
}


/* ==========================================
   VK API
   ========================================== */

async function vkApi(
    method,
    params = {}
) {

    try {

        /*
         * Без токена API вызывать не пытаемся.
         */

        if (!accessToken) {

            throw new Error(
                "Нет access token. Сначала необходимо получить разрешение VK."
            );

        }


        const requestParams = {

            ...params,

            access_token:
                accessToken,

            v:
                VK_API_VERSION
        };


        console.log(
            `VK API request: ${method}`,
            {
                ...requestParams,
                access_token: "***"
            }
        );


        const response =
            await vkBridge.send(
                "VKWebAppCallAPIMethod",
                {
                    method: method,

                    params:
                        requestParams
                }
            );


        console.log(
            `VK API response: ${method}`,
            response
        );


        /*
         * Вариант 1:
         *
         * {
         *   response: {...}
         * }
         *
         * Вариант 2:
         *
         * {
         *   error: {...}
         * }
         */


        if (response && response.error) {

            const message =
                response.error.error_msg ||
                response.error.error_code ||
                "VK API error";


            const error =
                new Error(
                    String(message)
                );


            error.vkError =
                response.error;


            throw error;
        }


        if (
            !response ||
            typeof response.response === "undefined"
        ) {

            throw new Error(
                "VK API не вернул response."
            );

        }


        return response.response;

    } catch (error) {

        logError(
            `VK API ${method} error:`,
            error
        );


        throw error;
    }
}


/* ==========================================
   ЗАГРУЗКА АЛЬБОМОВ
   ========================================== */

async function loadAlbums() {

    if (!currentUser) {

        throw new Error(
            "Пользователь VK ещё не получен."
        );

    }


    if (albumsElement) {

        albumsElement.innerHTML = `
            <div class="loading">
                Загружаем альбомы...
            </div>
        `;

    }


    try {

        console.log(
            "Загружаем альбомы пользователя:",
            currentUser.id
        );


        const result =
            await vkApi(
                "photos.getAlbums",
                {
                    owner_id:
                        currentUser.id,

                    need_system:
                        1,

                    need_covers:
                        1,

                    photo_sizes:
                        1,

                    count:
                        100
                }
            );


        albums =
            result.items || [];


        console.log(
            "Albums:",
            albums
        );


        renderAlbums();


        /*
         * Если текущий альбом больше
         * не существует — сбрасываем его.
         */

        if (
            currentAlbum &&
            !albums.some(
                album =>
                    album.id ===
                    currentAlbum.id
            )
        ) {

            currentAlbum = null;

            photos = [];


            if (albumHeaderElement) {

                albumHeaderElement
                    .classList
                    .add("hidden");

            }


            if (photosElement) {

                photosElement.innerHTML = `
                    <div class="empty">

                        <div class="empty-icon">
                            🖼️
                        </div>

                        Выберите альбом

                    </div>
                `;

            }

        }

    } catch (error) {

        logError(
            "Albums loading error:",
            error
        );


        const message =
            getErrorMessage(error);


        if (albumsElement) {

            albumsElement.innerHTML = `
                <div class="error">

                    <b>Не удалось загрузить альбомы.</b>

                    <br><br>

                    ${escapeHtml(message)}

                </div>
            `;

        }


        throw error;
    }
}


/* ==========================================
   ОТРИСОВКА АЛЬБОМОВ
   ========================================== */

function renderAlbums() {

    if (!albumsElement) {
        return;
    }


    albumsElement.innerHTML = "";


    if (!albums.length) {

        albumsElement.innerHTML = `
            <div class="loading">
                Альбомов нет
            </div>
        `;

        return;
    }


    albums.forEach(
        album => {

            const element =
                document.createElement(
                    "div"
                );


            element.className =
                "album" +
                (
                    currentAlbum &&
                    currentAlbum.id === album.id
                        ? " active"
                        : ""
                );


            element.dataset.id =
                String(album.id);


            element.innerHTML = `

                <div class="album-title">

                    ${escapeHtml(
                        album.title ||
                        "Без названия"
                    )}

                </div>

                <div class="album-size">

                    ${Number(album.size) || 0}
                    фото

                </div>

            `;


            element.addEventListener(
                "click",
                () => {

                    openAlbum(album);

                }
            );


            albumsElement.appendChild(
                element
            );

        }
    );
}


/* ==========================================
   ОТКРЫТИЕ АЛЬБОМА
   ========================================== */

async function openAlbum(album) {

    if (!album) {
        return;
    }


    currentAlbum =
        album;


    renderAlbums();


    if (albumHeaderElement) {

        albumHeaderElement
            .classList
            .remove("hidden");

    }


    if (albumTitleElement) {

        albumTitleElement.textContent =
            album.title ||
            "Альбом";

    }


    if (albumDescriptionElement) {

        albumDescriptionElement.textContent =
            album.description ||
            "";

    }


    if (photoCountElement) {

        photoCountElement.textContent =
            `${album.size || 0} фото`;

    }


    if (photosElement) {

        photosElement.innerHTML = `

            <div class="empty">

                <div class="empty-icon">
                    ⏳
                </div>

                Загружаем фотографии...

            </div>

        `;

    }


    try {

        await loadPhotos(
            album
        );

    } catch (error) {

        logError(
            "Photos loading error:",
            error
        );


        if (photosElement) {

            photosElement.innerHTML = `

                <div class="error">

                    <b>
                        Не удалось загрузить фотографии.
                    </b>

                    <br><br>

                    ${escapeHtml(
                        getErrorMessage(error)
                    )}

                </div>

            `;

        }

    }
}


/* ==========================================
   ЗАГРУЗКА ФОТОГРАФИЙ
   ========================================== */

async function loadPhotos(album) {

    if (!album) {

        throw new Error(
            "Альбом не указан."
        );

    }


    if (!currentUser) {

        throw new Error(
            "Пользователь не получен."
        );

    }


    console.log(
        "Загружаем фотографии:",
        {
            owner_id:
                currentUser.id,

            album_id:
                album.id
        }
    );


    const result =
        await vkApi(
            "photos.get",
            {
                owner_id:
                    currentUser.id,

                album_id:
                    album.id,

                extended:
                    1,

                photo_sizes:
                    1,

                count:
                    100
            }
        );


    photos =
        result.items || [];


    console.log(
        "Photos:",
        photos
    );


    renderPhotos();


    if (photoCountElement) {

        photoCountElement.textContent =
            `${photos.length} фото`;

    }
}


/* ==========================================
   ОТРИСОВКА ФОТОГРАФИЙ
   ========================================== */

function renderPhotos() {

    if (!photosElement) {
        return;
    }


    photosElement.innerHTML = "";


    if (!photos.length) {

        photosElement.innerHTML = `

            <div class="empty">

                <div class="empty-icon">
                    🖼️
                </div>

                В этом альбоме нет фотографий

            </div>

        `;

        return;
    }


    photos.forEach(
        photo => {

            const element =
                document.createElement(
                    "div"
                );


            element.className =
                "photo";


            const imageUrl =
                getBestPhotoUrl(
                    photo
                );


            element.innerHTML = `

                <img
                    src="${escapeHtml(imageUrl)}"
                    alt=""
                    loading="lazy"
                >

                <div class="photo-info">

                    ID: ${escapeHtml(
                        photo.id
                    )}

                </div>

            `;


            element.addEventListener(
                "click",
                () => {

                    openPhoto(
                        photo
                    );

                }
            );


            photosElement.appendChild(
                element
            );

        }
    );
}


/* ==========================================
   ПОЛУЧЕНИЕ ЛУЧШЕГО РАЗМЕРА ФОТО
   ========================================== */

function getBestPhotoUrl(photo) {

    if (
        photo &&
        Array.isArray(photo.sizes) &&
        photo.sizes.length
    ) {

        const sorted =
            [...photo.sizes]
                .filter(
                    size =>
                        size &&
                        size.url
                )
                .sort(
                    (a, b) =>
                        (
                            (b.width || 0) *
                            (b.height || 0)
                        ) -
                        (
                            (a.width || 0) *
                            (a.height || 0)
                        )
                );


        if (sorted.length) {

            return sorted[0].url;

        }

    }


    return photo && photo.url
        ? photo.url
        : "";
}


/* ==========================================
   ОТКРЫТИЕ ФОТОГРАФИИ
   ========================================== */

function openPhoto(photo) {

    console.log(
        "Selected photo:",
        photo
    );


    /*
     * Пока выводим информацию
     * в консоль.
     *
     * Позже здесь будет полноценное
     * окно редактирования фотографии:
     *
     * - название
     * - описание
     * - комментарии
     * - удалить
     * - копировать
     * - переместить
     */

}


/* ==========================================
   ОБНОВЛЕНИЕ АЛЬБОМОВ
   ========================================== */

if (refreshAlbumsButton) {

    refreshAlbumsButton
        .addEventListener(
            "click",
            async () => {

                try {

                    await loadAlbums();

                } catch (error) {

                    /*
                     * Ошибка уже показана
                     * внутри loadAlbums().
                     */

                    console.error(
                        "Refresh albums error:",
                        error
                    );

                }

            }
        );

}


/* ==========================================
   ЗАПУСК ПРИЛОЖЕНИЯ
   ========================================== */

async function startApp() {

    console.log(
        "================================="
    );

    console.log(
        "Starting VK Photo Manager..."
    );

    console.log(
        "VK App ID:",
        VK_APP_ID
    );

    console.log(
        "VK API version:",
        VK_API_VERSION
    );

    console.log(
        "================================="
    );


    /*
     * 1. Инициализация Bridge
     */

    const bridgeReady =
        await vkInit();


    if (!bridgeReady) {

        return;

    }


    /*
     * 2. Получаем пользователя
     */

    try {

        await loadUser();

    } catch (error) {

        showError(
            "Не удалось получить данные пользователя VK."
        );

        return;

    }


    if (!currentUser) {

        showError(
            "VK не вернул данные пользователя."
        );

        return;

    }


    /*
     * 3. Получаем access token.
     *
     * Именно этот этап отсутствовал
     * в старой версии.
     */

    try {

        await getAccessToken();

    } catch (error) {

        const message =
            getErrorMessage(error);


        if (photosElement) {

            photosElement.innerHTML = `

                <div class="error">

                    <b>
                        Не удалось получить разрешение VK
                    </b>

                    <br><br>

                    ${escapeHtml(message)}

                    <br><br>

                    Приложению нужен доступ
                    к фотографиям пользователя.

                </div>

            `;

        }


        return;

    }


    /*
     * 4. Загружаем альбомы.
     */

    try {

        await loadAlbums();

    } catch (error) {

        console.error(
            "Initial albums loading failed:",
            error
        );

    }


    console.log(
        "VK Photo Manager started."
    );
}


/* ==========================================
   START
   ========================================== */

startApp();
