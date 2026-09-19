import { state } from "./state.js?v=20260919-native01";
import { dom } from "./dom.js?v=20260919-native01";
import { vkApi } from "./vk-api.js?v=20260919-native01";
import { escapeHtml, getErrorMessage, getBestPhotoUrl } from "./helpers.js?v=20260919-native01";
import { showCommentsScreen } from "./navigation.js?v=20260919-native01";
import { closeMenu } from "./main-menu.js?v=20260919-native01";
import { CACHE_TTL, COMMENTS_DAYS } from "./config.js?v=20260919-native01";
import { cacheGet, cacheSet, albumPhotosKey, photoCommentsKey, commentsFeedKey } from "./cache.js?v=20260919-native01";
import { getOwnerId } from "./group-context.js?v=20260919-native01";

function cutoffTimestamp() {
    return Math.floor((Date.now() - COMMENTS_DAYS * 86400000) / 1000);
}

function getAuthor(data) {
    const id = data.comment.from_id;
    if (id > 0) {
        const p = data.profiles.find(x => x.id === id);
        if (p) return `${p.first_name || ""} ${p.last_name || ""}`.trim();
    }
    if (id < 0) {
        const g = data.groups.find(x => x.id === Math.abs(id));
        if (g) return g.name || "Сообщество";
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
            date.textContent = new Date(data.comment.date * 1000).toLocaleString("ru-RU");
        }

        body.append(album, author, text, date);
        card.appendChild(body);
        dom.comments.appendChild(card);
    });
}

async function getAlbumPhotos(album, force) {
    const ownerId = getOwnerId();
    const key = albumPhotosKey(ownerId, album.id);
    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.photos);
        if (cached) return cached;
    }

    const result = await vkApi("photos.get", {
        owner_id: ownerId,
        album_id: album.id,
        photo_sizes: 1,
        count: 100
    });

    const items = result.items || [];
    cacheSet(key, items);
    return items;
}

async function getPhotoComments(photo, force) {
    const ownerId = getOwnerId();
    const key = photoCommentsKey(ownerId, photo.id);
    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) return cached;
    }

    const result = await vkApi("photos.getComments", {
        owner_id: ownerId,
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
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const all = [];

    for (const album of state.albums) {
        let photos;
        try { photos = await getAlbumPhotos(album, force); }
        catch (e) { console.warn("Фото альбома:", album.title, e); continue; }

        for (const photo of photos) {
            let result;
            try { result = await getPhotoComments(photo, force); }
            catch (e) { console.warn("Комментарии фото:", photo.id, e); continue; }

            for (const comment of result.items) {
                if ((comment.date || 0) < cutoff) continue;
                all.push({
                    comment, photo, album,
                    profiles: result.profiles,
                    groups: result.groups
                });
            }
        }
    }

    all.sort((a, b) => (b.comment.date || 0) - (a.comment.date || 0));
    cacheSet(commentsFeedKey(ownerId), all);
    return all;
}

export async function loadAllComments({ force = false } = {}) {
    const key = commentsFeedKey(getOwnerId());

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) { renderComments(cached); return; }
    }

    dom.comments.innerHTML = '<div class="status-message">Загружаем комментарии...</div>';
    dom.refreshComments.disabled = true;

    try {
        renderComments(await buildCommentsFeed(force));
    } catch (error) {
        dom.comments.innerHTML =
            `<div class="error">Не удалось загрузить комментарии.<br><br>${escapeHtml(getErrorMessage(error))}</div>`;
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

    dom.refreshComments.addEventListener("click", () => loadAllComments({ force: true }));
}
