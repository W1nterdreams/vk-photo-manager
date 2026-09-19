import { dom } from "./dom.js?v=20260919-nav03";
import { vkApi } from "./vk-api.js?v=20260919-nav03";
import { escapeHtml, getErrorMessage, getPhotoPreviewUrl } from "./helpers.js?v=20260919-nav03";
import { showCommentsScreen, pushCommentsHistory } from "./navigation.js?v=20260919-nav03";
import { getOwnerId } from "./group-context.js?v=20260919-nav03";
import { cacheGet, cacheSet } from "./cache.js?v=20260919-nav03";
import { CACHE_TTL } from "./config.js?v=20260919-nav03";

const ALBUM_COMMENTS_DAYS = 3;
const PAGE_SIZE = 100;

let activeAlbum = null;
let loading = false;

function commentsTitleElement() {
    return document.querySelector(".comments-title");
}

function cacheKey(album) {
    return `album-comments:${getOwnerId()}:${album.id}:${ALBUM_COMMENTS_DAYS}d`;
}

function cutoffTimestamp() {
    return Math.floor((Date.now() - ALBUM_COMMENTS_DAYS * 86400000) / 1000);
}

function commentPhotoId(comment) {
    const value = comment?.photo_id ?? comment?.pid;
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

async function loadRecentRawComments(album) {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const recent = [];
    let offset = 0;

    while (true) {
        const result = await vkApi("photos.getAllComments", {
            owner_id: ownerId,
            album_id: Number(album.id),
            count: PAGE_SIZE,
            offset
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        let reachedOldComments = false;

        for (const comment of items) {
            const date = Number(comment?.date || 0);
            if (date < cutoff) {
                reachedOldComments = true;
                continue;
            }
            recent.push(comment);
        }

        offset += items.length;

        // photos.getAllComments возвращает комментарии в обратном
        // хронологическом порядке, поэтому после первого старого комментария
        // следующие страницы нам уже не нужны.
        if (reachedOldComments || items.length < PAGE_SIZE) break;
    }

    recent.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
    return recent;
}

async function loadPhotosForComments(comments) {
    const ownerId = getOwnerId();
    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))];
    const map = new Map();

    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        if (!chunk.length) continue;

        try {
            const photos = await vkApi("photos.getById", {
                photos: chunk.map(id => `${ownerId}_${id}`),
                photo_sizes: 1
            });

            for (const photo of Array.isArray(photos) ? photos : []) {
                map.set(String(photo.id), photo);
            }
        } catch (error) {
            console.warn("Не удалось получить превью фотографий комментариев:", error);
        }
    }

    return map;
}

async function loadAuthors(comments) {
    const userIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id > 0)
    )];

    const groupIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id < 0)
            .map(id => Math.abs(id))
    )];

    const authors = new Map();

    if (userIds.length) {
        try {
            const users = await vkApi("users.get", {
                user_ids: userIds
            });

            for (const user of Array.isArray(users) ? users : []) {
                const name = `${user.first_name || ""} ${user.last_name || ""}`.trim();
                authors.set(Number(user.id), name || `id${user.id}`);
            }
        } catch (error) {
            console.warn("Не удалось получить имена авторов комментариев:", error);
        }
    }

    if (groupIds.length) {
        try {
            const response = await vkApi("groups.getById", {
                group_ids: groupIds
            });

            for (const group of normalizeGroupsResponse(response)) {
                authors.set(-Math.abs(Number(group.id)), group.name || `club${group.id}`);
            }
        } catch (error) {
            console.warn("Не удалось получить названия сообществ-авторов:", error);
        }
    }

    return authors;
}

function authorName(comment, authors) {
    const id = Number(comment?.from_id || 0);
    if (authors.has(id)) return authors.get(id);
    if (id > 0) return `Пользователь ${id}`;
    if (id < 0) return `Сообщество ${Math.abs(id)}`;
    return "Пользователь";
}

function renderComments(album, data) {
    dom.comments.innerHTML = "";

    if (!data.comments.length) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Комментариев за последние ${ALBUM_COMMENTS_DAYS} дня нет
            </div>
        `;
        return;
    }

    for (const comment of data.comments) {
        const card = document.createElement("div");
        card.className = "comment-card";

        const photoId = commentPhotoId(comment);
        const photo = photoId ? data.photos.get(String(photoId)) : null;
        const photoUrl = getPhotoPreviewUrl(photo, 320);

        if (photoUrl) {
            const img = document.createElement("img");
            img.className = "comment-photo";
            img.src = photoUrl;
            img.alt = "";
            img.loading = "lazy";
            card.appendChild(img);
        }

        const body = document.createElement("div");
        body.className = "comment-body";

        const albumLabel = document.createElement("div");
        albumLabel.className = "comment-album";
        albumLabel.textContent = album.title || "Альбом";

        const author = document.createElement("div");
        author.className = "comment-author";
        author.textContent = authorName(comment, data.authors);

        const text = document.createElement("div");
        text.className = "comment-text";
        text.textContent = comment.text || "(без текста)";

        const date = document.createElement("div");
        date.className = "comment-date";
        if (comment.date) {
            date.textContent = new Date(Number(comment.date) * 1000)
                .toLocaleString("ru-RU");
        }

        body.append(albumLabel, author, text, date);
        card.appendChild(body);
        dom.comments.appendChild(card);
    }
}

async function fetchAlbumComments(album) {
    const comments = await loadRecentRawComments(album);

    const [photos, authors] = await Promise.all([
        loadPhotosForComments(comments),
        loadAuthors(comments)
    ]);

    return { comments, photos, authors };
}

function serializeForCache(data) {
    return {
        comments: data.comments,
        photos: [...data.photos.entries()],
        authors: [...data.authors.entries()]
    };
}

function restoreFromCache(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : [])
    };
}

export async function loadAlbumComments(album, { force = false } = {}) {
    if (!album || loading) return;

    activeAlbum = album;

    const title = commentsTitleElement();
    if (title) title.textContent = `Комментарии: ${album.title || "Альбом"}`;
    dom.pageTitle.textContent = "Комментарии альбома";

    const key = cacheKey(album);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            renderComments(album, restoreFromCache(cached));
            return;
        }
    }

    loading = true;
    dom.refreshComments.disabled = true;
    dom.comments.innerHTML = `
        <div class="status-message">
            Загружаем комментарии за последние ${ALBUM_COMMENTS_DAYS} дня...
        </div>
    `;

    try {
        const data = await fetchAlbumComments(album);
        cacheSet(key, serializeForCache(data));
        renderComments(album, data);
    } catch (error) {
        dom.comments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии альбома.<br><br>
                ${escapeHtml(getErrorMessage(error))}
            </div>
        `;
    } finally {
        loading = false;
        dom.refreshComments.disabled = false;
    }
}

async function openAlbumComments(album) {
    activeAlbum = album;
    pushCommentsHistory();
    showCommentsScreen();
    await loadAlbumComments(album);
}

export function initAlbumComments() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "comments") return;
        const album = event.detail.album;
        if (!album) return;
        void openAlbumComments(album);
    });

    // Обработчик в capture-фазе не даёт обычному модулю общих комментариев
    // перехватить кнопку обновления, когда открыт конкретный альбом.
    dom.refreshComments.addEventListener("click", event => {
        if (!activeAlbum) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void loadAlbumComments(activeAlbum, { force: true });
    }, true);

    // При переходе к общим комментариям сбрасываем режим конкретного альбома
    // и возвращаем обычный заголовок.
    dom.commentsMenuButton.addEventListener("click", () => {
        activeAlbum = null;
        const title = commentsTitleElement();
        if (title) title.textContent = "Комментарии к фотографиям";
    }, true);
}
