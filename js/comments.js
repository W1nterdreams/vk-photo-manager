import { state } from "./state.js?v=20260919-ui02";
import { dom } from "./dom.js?v=20260919-ui02";
import { vkApi } from "./vk-api.js?v=20260919-ui02";
import { escapeHtml, getErrorMessage, getPhotoPreviewUrl } from "./helpers.js?v=20260919-ui02";
import { showCommentsScreen, pushCommentsHistory } from "./navigation.js?v=20260919-ui02";
import { closeMenu } from "./main-menu.js?v=20260919-ui02";
import { CACHE_TTL } from "./config.js?v=20260919-ui02";
import { cacheGet, cacheSet } from "./cache.js?v=20260919-ui02";
import { getOwnerId } from "./group-context.js?v=20260919-ui02";
import { openVkProfile, openVkPhoto, openVkTarget } from "./vk-links.js?v=20260919-ui02";
import { openPhotoViewer } from "./photo-viewer.js?v=20260919-ui02";

const GLOBAL_COMMENTS_DAYS = 5;
const PAGE_SIZE = 100;
const READ_TIMEOUT_MS = 9000;
const CACHE_SCHEMA = 2;

function cacheKey() {
    return `global-comments:v${CACHE_SCHEMA}:${getOwnerId()}:${GLOBAL_COMMENTS_DAYS}d`;
}

function cutoffTimestamp() {
    return Math.floor((Date.now() - GLOBAL_COMMENTS_DAYS * 86400000) / 1000);
}

function commentPhotoId(comment) {
    const value = comment?.photo_id ?? comment?.pid;
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function apiRead(method, params) {
    return withTimeout(vkApi(method, params), READ_TIMEOUT_MS, method);
}

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function albumById(albumId) {
    const id = String(albumId ?? "");
    return state.albums.find(a => String(a.id) === id) ||
        state.albumIndex.find(a => String(a.id) === id) ||
        null;
}

function albumTitleForPhoto(photo) {
    const album = albumById(photo?.album_id);
    return album?.title || (photo?.album_id ? `Альбом ${photo.album_id}` : "Альбом");
}

function authorInfo(comment, authors) {
    const id = Number(comment?.from_id || 0);
    const known = authors.get(id);
    if (known) return known;

    return {
        id,
        name: id > 0
            ? `Пользователь ${id}`
            : id < 0
                ? `Сообщество ${Math.abs(id)}`
                : "Пользователь"
    };
}

function appendRichCommentText(container, text) {
    const raw = String(text || "");
    if (!raw) {
        container.textContent = "(без текста)";
        return;
    }

    const re = /\[((?:id|club|public)\d+)\|([^\]]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = re.exec(raw)) !== null) {
        const [full, target, label] = match;
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
        }

        const link = document.createElement("button");
        link.type = "button";
        link.className = "comment-inline-link";
        link.textContent = label;
        link.addEventListener("click", event => {
            event.stopPropagation();
            openVkTarget(target);
        });
        container.appendChild(link);
        lastIndex = match.index + full.length;
    }

    if (lastIndex < raw.length) {
        container.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
}

async function loadRecentComments() {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const comments = [];
    let offset = 0;

    while (true) {
        const result = await apiRead("photos.getAllComments", {
            owner_id: ownerId,
            count: PAGE_SIZE,
            offset
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        let reachedOldComments = false;
        for (const comment of items) {
            if (Number(comment?.date || 0) < cutoff) {
                reachedOldComments = true;
                break;
            }
            comments.push(comment);
        }

        if (reachedOldComments || items.length < PAGE_SIZE) break;
        offset += items.length;
    }

    return comments.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
}

async function loadPhotos(comments) {
    const ownerId = getOwnerId();
    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))];
    const photos = new Map();

    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        if (!chunk.length) continue;

        try {
            const result = await apiRead("photos.getById", {
                photos: chunk.map(id => `${ownerId}_${id}`).join(","),
                photo_sizes: 1,
                extended: 1
            });

            for (const photo of Array.isArray(result) ? result : []) {
                photos.set(String(photo.id), photo);
            }
        } catch (error) {
            console.warn("Не удалось получить фотографии для общей ленты комментариев:", error);
        }
    }

    return photos;
}

async function loadAuthors(comments) {
    const userIds = [...new Set(
        comments.map(c => Number(c?.from_id || 0)).filter(id => id > 0)
    )];
    const groupIds = [...new Set(
        comments.map(c => Number(c?.from_id || 0)).filter(id => id < 0).map(id => Math.abs(id))
    )];
    const authors = new Map();

    if (userIds.length) {
        try {
            const users = await apiRead("users.get", { user_ids: userIds.join(",") });
            for (const user of Array.isArray(users) ? users : []) {
                const id = Number(user.id || 0);
                if (!id) continue;
                authors.set(id, {
                    id,
                    name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`
                });
            }
        } catch (error) {
            console.warn("Не удалось получить авторов общей ленты комментариев:", error);
        }
    }

    if (groupIds.length) {
        try {
            const response = await apiRead("groups.getById", { group_ids: groupIds.join(",") });
            for (const group of normalizeGroupsResponse(response)) {
                const id = -Math.abs(Number(group.id || 0));
                if (!id) continue;
                authors.set(id, {
                    id,
                    name: group.name || `club${Math.abs(id)}`
                });
            }
        } catch (error) {
            console.warn("Не удалось получить сообщества-авторов общей ленты:", error);
        }
    }

    return authors;
}

function serializeData(data) {
    return {
        comments: data.comments,
        photos: [...data.photos.entries()],
        authors: [...data.authors.entries()]
    };
}

function restoreData(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : [])
    };
}

function renderComments(data) {
    dom.comments.innerHTML = "";

    const title = document.querySelector(".comments-title");
    if (title) title.textContent = `Комментарии за последние ${GLOBAL_COMMENTS_DAYS} дней`;
    dom.pageTitle.textContent = "Комментарии";

    if (!data.comments.length) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Комментариев за последние ${GLOBAL_COMMENTS_DAYS} дней нет
            </div>
        `;
        return;
    }

    for (const comment of data.comments) {
        const photoId = commentPhotoId(comment);
        const photo = photoId ? data.photos.get(String(photoId)) : null;
        const album = albumById(photo?.album_id);
        const author = authorInfo(comment, data.authors);

        const card = document.createElement("div");
        card.className = "comment-card comment-card-rich";

        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "comment-thumb-button";

        const photoUrl = getPhotoPreviewUrl(photo, 220);
        if (photoUrl) {
            const image = document.createElement("img");
            image.className = "comment-photo";
            image.src = photoUrl;
            image.alt = "";
            image.loading = "lazy";
            thumb.appendChild(image);
        } else {
            const placeholder = document.createElement("div");
            placeholder.className = "comment-photo comment-photo-placeholder";
            placeholder.textContent = "🖼";
            thumb.appendChild(placeholder);
        }

        thumb.addEventListener("click", event => {
            event.stopPropagation();
            if (!photoId) return;
            const targetPhoto = photo || {
                id: photoId,
                owner_id: getOwnerId(),
                album_id: album?.id
            };
            void openPhotoViewer(targetPhoto, album, { fromComments: true });
        });

        const body = document.createElement("div");
        body.className = "comment-body";

        const albumName = document.createElement("div");
        albumName.className = "comment-album";
        albumName.textContent = albumTitleForPhoto(photo);

        const header = document.createElement("div");
        header.className = "comment-header";

        const authorButton = document.createElement("button");
        authorButton.type = "button";
        authorButton.className = "comment-author-link";
        authorButton.textContent = author.name;
        authorButton.addEventListener("click", event => {
            event.stopPropagation();
            if (author.id) openVkProfile(author.id);
        });
        header.appendChild(authorButton);

        const text = document.createElement("div");
        text.className = "comment-text";
        appendRichCommentText(text, comment.text || "");

        const meta = document.createElement("div");
        meta.className = "comment-meta-row";

        const date = document.createElement("div");
        date.className = "comment-date";
        date.textContent = comment.date
            ? new Date(Number(comment.date) * 1000).toLocaleString("ru-RU")
            : "";

        const reply = document.createElement("button");
        reply.type = "button";
        reply.className = "comment-reply-link";
        reply.textContent = "Ответить";
        reply.addEventListener("click", event => {
            event.stopPropagation();
            if (!photoId) return;
            openVkPhoto(photo || { id: photoId, owner_id: getOwnerId() }, getOwnerId());
        });

        meta.append(date, reply);
        body.append(albumName, header, text, meta);
        card.append(thumb, body);
        dom.comments.appendChild(card);
    }
}

async function buildCommentsFeed() {
    const comments = await loadRecentComments();
    if (!comments.length) {
        return { comments: [], photos: new Map(), authors: new Map() };
    }

    const [photos, authors] = await Promise.all([
        loadPhotos(comments),
        loadAuthors(comments)
    ]);

    return { comments, photos, authors };
}

export async function loadAllComments({ force = false } = {}) {
    const key = cacheKey();

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            renderComments(restoreData(cached));
            return;
        }
    }

    dom.comments.innerHTML = `
        <div class="status-message">
            Загружаем комментарии всех альбомов за ${GLOBAL_COMMENTS_DAYS} дней...
        </div>
    `;
    dom.refreshComments.disabled = true;

    try {
        const data = await buildCommentsFeed();
        cacheSet(key, serializeData(data));
        renderComments(data);
    } catch (error) {
        dom.comments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии.<br><br>
                ${escapeHtml(getErrorMessage(error))}
            </div>
        `;
    } finally {
        dom.refreshComments.disabled = false;
    }
}

export function initComments() {
    dom.commentsMenuButton.addEventListener("click", async () => {
        closeMenu();
        pushCommentsHistory();
        showCommentsScreen();
        await loadAllComments();
    });

    dom.refreshComments.addEventListener("click", () => loadAllComments({ force: true }));
}
