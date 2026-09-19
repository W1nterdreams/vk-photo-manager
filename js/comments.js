import { state } from "./state.js";
import { dom } from "./dom.js";
import { vkApi } from "./vk-api.js";
import { escapeHtml, getErrorMessage, getBestPhotoUrl } from "./helpers.js";
import { showCommentsScreen } from "./navigation.js";
import { closeMenu } from "./main-menu.js";
import { CACHE_TTL, COMMENTS_DAYS } from "./config.js";
import {
    cacheGet,
    cacheSet,
    albumPhotosKey,
    photoCommentsKey,
    commentsFeedKey
} from "./cache.js";

function cutoffTimestamp() {
    return Math.floor(
        (Date.now() - COMMENTS_DAYS * 24 * 60 * 60 * 1000) / 1000
    );
}

function getAuthor(data) {
    const id = data.comment.from_id;

    if (id > 0) {
        const profile = data.profiles.find(item => item.id === id);
        if (profile) {
            return `${profile.first_name || ""} ${profile.last_name || ""}`.trim();
        }
    }

    if (id < 0) {
        const group = data.groups.find(item => item.id === Math.abs(id));
        if (group) return group.name || "Сообщество";
    }

    return "Пользователь";
}

function renderComments(items) {
    dom.comments.innerHTML = "";

    if (!items.length) {
        dom.comments.innerHTML =
            `<div class="status-message">Комментариев за последние ${COMMENTS_DAYS} дней нет</div>`;
        return;
    }

    items.forEach(data => {
        const card = document.createElement("div");
        card.className = "comment-card";

        const url = getBestPhotoUrl(data.photo);

        if (url) {
            const img = document.createElement("img");
            img.className = "comment-photo";
            img.src = url;
            img.alt = "";
            img.loading = "lazy";
            card.appendChild(img);
        }

        const body = document.createElement("div");
        body.className = "comment-body";

        const album = document.createElement("div");
        album.className = "comment-album";
        album.textContent = data.album.title || "Альбом";

        const author = document.createElement("div");
        author.className = "comment-author";
        author.textContent = getAuthor(data);

        const text = document.createElement("div");
        text.className = "comment-text";
        text.textContent = data.comment.text || "(без текста)";

        const date = document.createElement("div");
        date.className = "comment-date";

        if (data.comment.date) {
            date.textContent =
                new Date(data.comment.date * 1000).toLocaleString("ru-RU");
        }

        body.append(album, author, text, date);
        card.appendChild(body);
        dom.comments.appendChild(card);
    });
}

async function getAlbumPhotos(album, force) {
    const key = albumPhotosKey(state.currentUser.id, album.id);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.photos);
        if (cached) return cached;
    }

    const result = await vkApi("photos.get", {
        owner_id: state.currentUser.id,
        album_id: album.id,
        photo_sizes: 1,
        count: 100
    });

    const items = result.items || [];
    cacheSet(key, items);
    return items;
}

async function getPhotoComments(photo, force) {
    const key = photoCommentsKey(state.currentUser.id, photo.id);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) return cached;
    }

    const result = await vkApi("photos.getComments", {
        owner_id: state.currentUser.id,
        photo_id: photo.id,
        extended: 1,
        count: 100,
        sort: "desc"
    });

    const data = {
        items: result.items || [],
        profiles: result.profiles || [],
        groups: result.groups || []
    };

    cacheSet(key, data);
    return data;
}

async function buildCommentsFeed(force) {
    const cutoff = cutoffTimestamp();
    const all = [];

    for (const album of state.albums) {
        let albumPhotos;

        try {
            albumPhotos = await getAlbumPhotos(album, force);
        } catch (error) {
            console.warn("Не удалось получить фото альбома:", album.title, error);
            continue;
        }

        for (const photo of albumPhotos) {
            let result;

            try {
                result = await getPhotoComments(photo, force);
            } catch (error) {
                console.warn("Не удалось получить комментарии фото:", photo.id, error);
                continue;
            }

            for (const comment of result.items) {
                if ((comment.date || 0) < cutoff) continue;

                all.push({
                    comment,
                    photo,
                    album,
                    profiles: result.profiles,
                    groups: result.groups
                });
            }
        }
    }

    all.sort(
        (a, b) => (b.comment.date || 0) - (a.comment.date || 0)
    );

    cacheSet(commentsFeedKey(state.currentUser.id), all);
    return all;
}

export async function loadAllComments({ force = false } = {}) {
    const feedKey = commentsFeedKey(state.currentUser.id);

    if (!force) {
        const cachedFeed = cacheGet(feedKey, CACHE_TTL.comments);

        if (cachedFeed) {
            renderComments(cachedFeed);
            return;
        }
    }

    dom.comments.innerHTML =
        '<div class="status-message">Загружаем комментарии...</div>';

    dom.refreshComments.disabled = true;

    try {
        const all = await buildCommentsFeed(force);
        renderComments(all);
    } catch (error) {
        dom.comments.innerHTML =
            `<div class="error">Не удалось загрузить комментарии.<br><br>${
                escapeHtml(getErrorMessage(error))
            }</div>`;
    } finally {
        dom.refreshComments.disabled = false;
    }
}

export function initComments() {
    dom.commentsMenuButton.addEventListener("click", async () => {
        closeMenu();
        showCommentsScreen();
        await loadAllComments();
    });

    dom.refreshComments.addEventListener("click", () =>
        loadAllComments({ force: true })
    );
}
