const PREFIX = "vk-photo-manager:v4:";
const LEGACY_ROOT_PREFIX = "vk-photo-manager:";

function fullKey(key) {
    return PREFIX + key;
}

export function cacheSet(key, value) {
    try {
        localStorage.setItem(
            fullKey(key),
            JSON.stringify({
                savedAt: Date.now(),
                value
            })
        );
        return true;
    } catch (error) {
        console.warn("Не удалось записать кэш:", key, error);
        return false;
    }
}

export function cacheGet(key, maxAgeMs = 0) {
    try {
        const raw = localStorage.getItem(fullKey(key));
        if (!raw) return null;

        const data = JSON.parse(raw);

        if (
            !data ||
            typeof data.savedAt !== "number" ||
            !("value" in data)
        ) {
            cacheRemove(key);
            return null;
        }

        if (
            maxAgeMs > 0 &&
            Date.now() - data.savedAt > maxAgeMs
        ) {
            return null;
        }

        return data.value;
    } catch (error) {
        console.warn("Не удалось прочитать кэш:", key, error);
        return null;
    }
}

export function cacheGetStale(key) {
    try {
        const raw = localStorage.getItem(fullKey(key));
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data?.value ?? null;
    } catch {
        return null;
    }
}

export function cacheRemove(key) {
    try {
        localStorage.removeItem(fullKey(key));
    } catch {}
}

export function cacheRemoveByPrefix(keyPrefix) {
    try {
        const prefix = fullKey(keyPrefix);
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось очистить часть кэша:", error);
    }
}

export function clearAppCache() {
    try {
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(PREFIX)) keys.push(key);
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось очистить кэш приложения:", error);
    }
}

// Удаляем старые схемы кэша. Это важно после изменений структуры данных:
// старый частичный индекс альбомов больше никогда не должен считаться полным.
export function cleanupLegacyCache() {
    try {
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
                key &&
                key.startsWith(LEGACY_ROOT_PREFIX) &&
                !key.startsWith(PREFIX)
            ) {
                keys.push(key);
            }
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось удалить старый кэш приложения:", error);
    }
}

export function albumPhotosKey(ownerId, albumId) {
    return `photos-v3:${ownerId}:${albumId}`;
}

export function photoCommentsKey(ownerId, photoId) {
    return `comments:${ownerId}:${photoId}`;
}

export function albumsKey(ownerId) {
    return `albums:${ownerId}`;
}

export function commentsFeedKey(ownerId) {
    return `comments-feed:${ownerId}`;
}

export function albumIndexKey(ownerId) {
    return `album-index-v3:${ownerId}`;
}

export function invalidateAlbumCaches(ownerId) {
    cacheRemove(albumsKey(ownerId));
    cacheRemove(albumIndexKey(ownerId));
}

export function invalidateAlbumPhotosCache(ownerId, albumId) {
    if (!ownerId || !albumId) return;
    cacheRemove(albumPhotosKey(ownerId, albumId));
}

export function invalidateCommentCaches(ownerId, { photoId = 0 } = {}) {
    if (photoId) cacheRemove(photoCommentsKey(ownerId, photoId));

    // Эти ленты имеют свои schema/version в ключе, поэтому чистим по типу.
    cacheRemoveByPrefix("global-comments:");
    cacheRemoveByPrefix("album-comments:");
    cacheRemove(commentsFeedKey(ownerId));
}

export function invalidatePhotoActivityCaches(ownerId, albumId, photoId = 0) {
    invalidateAlbumPhotosCache(ownerId, albumId);
    invalidateCommentCaches(ownerId, { photoId });
}
