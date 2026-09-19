"use strict";


/*
 * ============================
 * VK PHOTO MANAGER
 * Первый рабочий вариант
 * ============================
 */


/* ============================
   Глобальное состояние
   ============================ */

let currentUser = null;

let albums = [];

let currentAlbum = null;

let photos = [];


/* ============================
   DOM
   ============================ */

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


/* ============================
   VK Bridge
   ============================ */

async function vkInit() {

    try {

        await vkBridge.send("VKWebAppInit");

        console.log("VK Bridge initialized");

    } catch (error) {

        console.error(
            "VK Bridge initialization error:",
            error
        );

        showError(
            "Не удалось инициализировать VK Bridge"
        );
    }
}


/* ============================
   Получение пользователя
   ============================ */

async function loadUser() {

    try {

        const result =
            await vkBridge.send(
                "VKWebAppGetUserInfo"
            );

        console.log(
            "VKWebAppGetUserInfo result:",
            result
        );

        if (!result || !result.id) {

            throw new Error(
                "VK не вернул данные пользователя"
            );
        }

        currentUser = result;

        const firstName =
            result.first_name || "";

        const lastName =
            result.last_name || "";

        userElement.textContent =
            `${firstName} ${lastName}`.trim();

        console.log(
            "Current user:",
            currentUser
        );

        return true;

    } catch (error) {

        console.error(
            "User loading error:",
            error
        );

        currentUser = null;

        userElement.textContent =
            "Не удалось определить пользователя";

        return false;
    }
}


/* ============================
   VK API
   ============================ */

async function vkApi(
    method,
    params = {}
) {

    try {

        const response =
            await vkBridge.send(
                "VKWebAppCallAPIMethod",
                {
                    method: method,

                    params: {
                        ...params,

                        v: "5.199"
                    }
                }
            );

        if (response.error) {

            throw new Error(
                response.error.error_msg ||
                "VK API error"
            );
        }

        return response.response;

    } catch (error) {

        console.error(
            `VK API ${method} error:`,
            error
        );

        throw error;
    }
}


/* ============================
   Загрузка альбомов
   ============================ */

async function loadAlbums() {

    albumsElement.innerHTML =
        `<div class="loading">
            Загружаем альбомы...
        </div>`;

    try {

        const result =
            await vkApi(
                "photos.getAlbums",
                {
                    owner_id: currentUser.id,

                    need_system: 1,

                    need_covers: 1,

                    photo_sizes: 1,

                    count: 100
                }
            );


        albums =
            result.items || [];


        renderAlbums();


        console.log(
            "Albums:",
            albums
        );

    } catch (error) {

        console.error(
            "Albums loading error:",
            error
        );

        albumsElement.innerHTML =
            `<div class="error">
                Не удалось загрузить альбомы.<br>
                ${escapeHtml(error.message)}
            </div>`;
    }
}


/* ============================
   Отрисовка альбомов
   ============================ */

function renderAlbums() {

    albumsElement.innerHTML = "";


    if (!albums.length) {

        albumsElement.innerHTML =
            `<div class="loading">
                Альбомов нет
            </div>`;

        return;
    }


    albums.forEach(album => {

        const element =
            document.createElement("div");


        element.className =
            "album" +
            (
                currentAlbum &&
                currentAlbum.id === album.id
                    ? " active"
                    : ""
            );


        element.dataset.id =
            album.id;


        element.innerHTML = `

            <div class="album-title">
                ${escapeHtml(album.title)}
            </div>

            <div class="album-size">
                ${album.size || 0} фото
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

    });
}


/* ============================
   Открытие альбома
   ============================ */

async function openAlbum(album) {

    currentAlbum = album;


    renderAlbums();


    albumHeaderElement
        .classList
        .remove("hidden");


    albumTitleElement.textContent =
        album.title || "Альбом";


    albumDescriptionElement.textContent =
        album.description || "";


    photoCountElement.textContent =
        `${album.size || 0} фото`;


    photosElement.innerHTML =
        `<div class="empty">
            <div class="empty-icon">
                ⏳
            </div>
            Загружаем фотографии...
        </div>`;


    try {

        await loadPhotos(album);

    } catch (error) {

        console.error(
            "Photos loading error:",
            error
        );

        photosElement.innerHTML =
            `<div class="error">
                Не удалось загрузить фотографии.<br>
                ${escapeHtml(error.message)}
            </div>`;
    }
}


/* ============================
   Загрузка фотографий
   ============================ */

async function loadPhotos(album) {

    const result =
        await vkApi(
            "photos.get",
            {
                owner_id: currentUser.id,

                album_id: album.id,

                extended: 1,

                photo_sizes: 1,

                count: 100
            }
        );


    photos =
        result.items || [];


    renderPhotos();


    photoCountElement.textContent =
        `${photos.length} фото`;


    console.log(
        "Photos:",
        photos
    );
}


/* ============================
   Отрисовка фотографий
   ============================ */

function renderPhotos() {

    photosElement.innerHTML = "";


    if (!photos.length) {

        photosElement.innerHTML =
            `<div class="empty">

                <div class="empty-icon">
                    🖼️
                </div>

                В этом альбоме нет фотографий

            </div>`;

        return;
    }


    photos.forEach(photo => {

        const element =
            document.createElement("div");


        element.className =
            "photo";


        const imageUrl =
            getBestPhotoUrl(photo);


        element.innerHTML = `

            <img
                src="${imageUrl}"
                alt=""
                loading="lazy"
            >

            <div class="photo-info">

                ID: ${photo.id}

            </div>

        `;


        element.addEventListener(
            "click",
            () => {

                openPhoto(photo);

            }
        );


        photosElement.appendChild(
            element
        );

    });
}


/* ============================
   Получение лучшего размера
   ============================ */

function getBestPhotoUrl(photo) {

    if (
        photo.sizes &&
        photo.sizes.length
    ) {

        const sorted =
            [...photo.sizes].sort(
                (a, b) =>
                    (b.width * b.height) -
                    (a.width * a.height)
            );


        return sorted[0].url;
    }


    return photo.url || "";
}


/* ============================
   Открытие фотографии
   ============================ */

function openPhoto(photo) {

    console.log(
        "Selected photo:",
        photo
    );


    /*
     * Пока просто показываем
     * информацию в консоли.
     *
     * Здесь позже появится
     * полноценное окно фотографии:
     *
     * - название
     * - описание
     * - комментарии
     * - удалить
     * - копировать
     * - переместить
     */
}


/* ============================
   Обновление альбомов
   ============================ */

refreshAlbumsButton
    .addEventListener(
        "click",
        async () => {

            await loadAlbums();

        }
    );


/* ============================
   Экранирование HTML
   ============================ */

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


/* ============================
   Ошибка
   ============================ */

function showError(message) {

    photosElement.innerHTML =
        `<div class="error">
            ${escapeHtml(message)}
        </div>`;
}


/* ============================
   Запуск приложения
   ============================ */

async function startApp() {

    console.log(
        "Starting VK Photo Manager..."
    );

    await vkInit();

    const userLoaded =
        await loadUser();

    if (!userLoaded) {

        albumsElement.innerHTML =
            `<div class="error">
                Не удалось определить пользователя VK.
            </div>`;

        return;
    }

    await loadAlbums();
}


/* ============================
   START
   ============================ */

startApp();
