const PREFIX = "vk-photo-manager:";

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

export function albumPhotosKey(ownerId, albumId) {
    return `photos-v2:${ownerId}:${albumId}`;
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
    return `album-index:${ownerId}`;
}
