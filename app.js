"use strict";


/* ==========================================
   НАСТРОЙКИ
   ========================================== */

const VK_APP_ID = 54771516;
const VK_API_VERSION = "5.199";


/* ==========================================
   СОСТОЯНИЕ
   ========================================== */

let currentUser = null;
let accessToken = null;

let albums = [];
let currentAlbum = null;
let photos = [];

let albumSearchText = "";


/* ==========================================
   DOM
   ========================================== */

const userElement =
    document.getElementById("user");

const pageTitleElement =
    document.getElementById("pageTitle");

const albumsScreen =
    document.getElementById("albumsScreen");

const photosScreen =
    document.getElementById("photosScreen");

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

const backButton =
    document.getElementById("backButton");

const albumSearch =
    document.getElementById("albumSearch");

const clearSearchButton =
    document.getElementById("clearSearch");


/* ==========================================
   ОШИБКИ
   ========================================== */

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

    if (
        error.error &&
        error.error.error_msg
    ) {
        return error.error.error_msg;
    }

    try {

        return JSON.stringify(
            error,
            null,
            2
        );

    } catch {

        return String(error);

    }
}


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

    } catch {
        // ничего
    }
}


/* ==========================================
   HTML
   ========================================== */

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ==========================================
   VK BRIDGE
   ========================================== */

async function vkInit() {

    await vkBridge.send(
        "VKWebAppInit"
    );

    console.log(
        "VK Bridge initialized"
    );
}


/* ==========================================
   ПОЛЬЗОВАТЕЛЬ
   ========================================== */

async function loadUser() {

    const result =
        await vkBridge.send(
            "VKWebAppGetUserInfo"
        );

    currentUser = result;

    const name =
        `${result.first_name || ""} ${result.last_name || ""}`
            .trim();

    if (userElement) {

        userElement.textContent =
            name || "Пользователь";

    }

    console.log(
        "Current user:",
        result
    );
}


/* ==========================================
   ACCESS TOKEN
   ========================================== */

async function getAccessToken() {

    console.log(
        "Получаем photos access token..."
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
        result.access_token;

    if (!accessToken) {

        throw new Error(
            "VK не вернул access token."
        );

    }

    console.log(
        "Access token получен"
    );
}


/* ==========================================
   VK API
   ========================================== */

async function vkApi(
    method,
    params = {}
) {

    if (!accessToken) {

        throw new Error(
            "Нет access token."
        );

    }

    try {

        const response =
            await vkBridge.send(
                "VKWebAppCallAPIMethod",
                {
                    method,

                    params: {
                        ...params,

                        access_token:
                            accessToken,

                        v:
                            VK_API_VERSION
                    }
                }
            );

        if (
            response &&
            response.error
        ) {

            throw response.error;

        }

        if (
            !response ||
            typeof response.response ===
                "undefined"
        ) {

            throw new Error(
                "VK API не вернул response."
            );

        }

        return response.response;

    } catch (error) {

        logError(
            `VK API ${method}:`,
            error
        );

        throw error;

    }
}


/* ==========================================
   ОБЛОЖКА АЛЬБОМА
   ========================================== */

function getAlbumCover(album) {

    /*
     * При need_covers=1 VK обычно
     * возвращает sizes.
     */

    if (
        Array.isArray(album.sizes) &&
        album.sizes.length
    ) {

        const sizes =
            album.sizes
                .filter(
                    item =>
                        item &&
                        item.src
                )
                .sort(
                    (a, b) => {

                        const areaA =
                            (a.width || 0) *
                            (a.height || 0);

                        const areaB =
                            (b.width || 0) *
                            (b.height || 0);

                        return areaB - areaA;
                    }
                );

        if (sizes.length) {

            return sizes[0].src;

        }

    }


    /*
     * В некоторых ответах может быть thumb.
     */

    if (album.thumb) {

        if (
            Array.isArray(album.thumb.sizes)
        ) {

            const sizes =
                album.thumb.sizes
                    .filter(
                        item =>
                            item &&
                            (
                                item.url ||
                                item.src
                            )
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

            if (sizes.length) {

                return (
                    sizes[0].url ||
                    sizes[0].src
                );

            }

        }

    }


    return "";
}


/* ==========================================
   ЗАГРУЗКА АЛЬБОМОВ
   ========================================== */

async function loadAlbums() {

    albumsElement.innerHTML = `
        <div class="status-message">
            Загружаем альбомы...
        </div>
    `;


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
}


/* ==========================================
   ПОИСК АЛЬБОМОВ
   ========================================== */

function getFilteredAlbums() {

    const search =
        albumSearchText
            .trim()
            .toLocaleLowerCase("ru");


    if (!search) {

        /*
         * Возвращаем исходный массив.
         * То есть порядок VK не меняем.
         */

        return albums;

    }


    return albums.filter(
        album => {

            const title =
                String(
                    album.title || ""
                )
                    .toLocaleLowerCase("ru");


            return title.includes(
                search
            );

        }
    );
}


/* ==========================================
   ОТРИСОВКА АЛЬБОМОВ
   ========================================== */

function renderAlbums() {

    albumsElement.innerHTML = "";


    const filteredAlbums =
        getFilteredAlbums();


    if (!filteredAlbums.length) {

        if (albumSearchText.trim()) {

            albumsElement.innerHTML = `
                <div class="status-message">
                    Альбомы не найдены
                </div>
            `;

        } else {

            albumsElement.innerHTML = `
                <div class="status-message">
                    Альбомов нет
                </div>
            `;

        }

        return;
    }


    filteredAlbums.forEach(
        album => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "album-card";


            const cover =
                getAlbumCover(
                    album
                );


            /*
             * Обложка.
             */

            if (cover) {

                const img =
                    document.createElement(
                        "img"
                    );


                img.className =
                    "album-cover";


                img.src =
                    cover;


                img.alt =
                    album.title || "";


                img.loading =
                    "lazy";


                card.appendChild(
                    img
                );

            } else {

                const placeholder =
                    document.createElement(
                        "div"
                    );


                placeholder.className =
                    "album-placeholder";


                placeholder.textContent =
                    "▣";


                card.appendChild(
                    placeholder
                );

            }


            /*
             * Название + количество.
             */

            const info =
                document.createElement(
                    "div"
                );


            info.className =
                "album-info";


            const name =
                document.createElement(
                    "div"
                );


            name.className =
                "album-name";


            name.textContent =
                album.title ||
                "Без названия";


            const count =
                document.createElement(
                    "div"
                );


            count.className =
                "album-count";


            count.textContent =
                String(
                    album.size || 0
                );


            info.appendChild(
                name
            );


            info.appendChild(
                count
            );


            card.appendChild(
                info
            );


            card.addEventListener(
                "click",
                () => {

                    openAlbum(
                        album
                    );

                }
            );


            albumsElement.appendChild(
                card
            );

        }
    );
}


/* ==========================================
   ПОИСК — СОБЫТИЯ
   ========================================== */

albumSearch.addEventListener(
    "input",
    event => {

        albumSearchText =
            event.target.value;


        /*
         * Показываем крестик,
         * когда есть текст.
         */

        if (
            albumSearchText.length > 0
        ) {

            clearSearchButton
                .classList
                .remove("hidden");

        } else {

            clearSearchButton
                .classList
                .add("hidden");

        }


        renderAlbums();

    }
);


clearSearchButton.addEventListener(
    "click",
    () => {

        albumSearch.value =
            "";

        albumSearchText =
            "";

        clearSearchButton
            .classList
            .add("hidden");


        renderAlbums();


        albumSearch.focus();

    }
);


/* ==========================================
   ОТКРЫТИЕ АЛЬБОМА
   ========================================== */

async function openAlbum(album) {

    currentAlbum =
        album;


    /*
     * Переключаем экран.
     */

    albumsScreen
        .classList
        .add("hidden");


    photosScreen
        .classList
        .remove("hidden");


    backButton
        .classList
        .remove("hidden");


    refreshAlbumsButton
        .classList
        .add("hidden");


    pageTitleElement.textContent =
        album.title ||
        "Альбом";


    albumTitleElement.textContent =
        album.title ||
        "Альбом";


    albumDescriptionElement.textContent =
        album.description ||
        "";


    photoCountElement.textContent =
        `${album.size || 0} фото`;


    photosElement.innerHTML = `
        <div class="status-message">
            Загружаем фотографии...
        </div>
    `;


    window.scrollTo(
        0,
        0
    );


    try {

        await loadPhotos(
            album
        );

    } catch (error) {

        photosElement.innerHTML = `
            <div class="error">
                Не удалось загрузить фотографии.
                <br><br>
                ${escapeHtml(
                    getErrorMessage(error)
                )}
            </div>
        `;

    }
}


/* ==========================================
   НАЗАД К АЛЬБОМАМ
   ========================================== */

function showAlbumsScreen() {

    currentAlbum =
        null;


    photosScreen
        .classList
        .add("hidden");


    albumsScreen
        .classList
        .remove("hidden");


    backButton
        .classList
        .add("hidden");


    refreshAlbumsButton
        .classList
        .remove("hidden");


    pageTitleElement.textContent =
        "Фотоальбомы";


    window.scrollTo(
        0,
        0
    );
}


backButton.addEventListener(
    "click",
    showAlbumsScreen
);


/* ==========================================
   ЗАГРУЗКА ФОТО
   ========================================== */

async function loadPhotos(album) {

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


    photoCountElement.textContent =
        `${photos.length} фото`;
}


/* ==========================================
   URL ФОТО
   ========================================== */

function getBestPhotoUrl(photo) {

    if (
        !photo ||
        !Array.isArray(photo.sizes)
    ) {

        return "";

    }


    const sizes =
        photo.sizes
            .filter(
                item =>
                    item &&
                    item.url
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


    if (!sizes.length) {

        return "";

    }


    return sizes[0].url;
}


/* ==========================================
   ОТРИСОВКА ФОТО
   ========================================== */

function renderPhotos() {

    photosElement.innerHTML =
        "";


    if (!photos.length) {

        photosElement.innerHTML = `
            <div class="status-message">
                В этом альбоме нет фотографий
            </div>
        `;

        return;
    }


    photos.forEach(
        photo => {

            const card =
                document.createElement(
                    "div"
                );


            card.className =
                "photo-card";


            const imageUrl =
                getBestPhotoUrl(
                    photo
                );


            if (imageUrl) {

                const img =
                    document.createElement(
                        "img"
                    );


                img.src =
                    imageUrl;


                img.alt =
                    photo.text || "";


                img.loading =
                    "lazy";


                card.appendChild(
                    img
                );

            }


            card.addEventListener(
                "click",
                () => {

                    console.log(
                        "Selected photo:",
                        photo
                    );

                }
            );


            photosElement.appendChild(
                card
            );

        }
    );
}


/* ==========================================
   ОБНОВЛЕНИЕ
   ========================================== */

refreshAlbumsButton.addEventListener(
    "click",
    async () => {

        try {

            await loadAlbums();

        } catch (error) {

            albumsElement.innerHTML = `
                <div class="error">

                    Не удалось обновить альбомы.

                    <br><br>

                    ${escapeHtml(
                        getErrorMessage(error)
                    )}

                </div>
            `;

        }

    }
);


/* ==========================================
   ЗАПУСК
   ========================================== */

async function startApp() {

    console.log(
        "Starting VK Photo Manager..."
    );


    try {

        /*
         * 1. VK Bridge
         */

        await vkInit();


        /*
         * 2. Пользователь
         */

        await loadUser();


        /*
         * 3. Токен photos
         */

        await getAccessToken();


        /*
         * 4. Альбомы
         */

        await loadAlbums();


        console.log(
            "VK Photo Manager started."
        );

    } catch (error) {

        logError(
            "Application startup error:",
            error
        );


        albumsElement.innerHTML = `
            <div class="error">

                <b>
                    Ошибка запуска приложения
                </b>

                <br><br>

                ${escapeHtml(
                    getErrorMessage(error)
                )}

            </div>
        `;

    }
}


startApp();
