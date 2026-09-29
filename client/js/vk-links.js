function isMobileDevice() {
    return /Android|iPhone|iPad|iPod/i.test(String(navigator.userAgent || ""));
}

function isNativeVkClient() {
    return Boolean(
        isMobileDevice() ||
        window.AndroidBridge ||
        window.webkit?.messageHandlers?.VKWebAppClose ||
        window.ReactNativeWebView
    );
}

function openVkTarget(target) {
    if (!target) return false;

    const web = `https://vk.com/${target}`;
    const native = `vk://vk.com/${target}`;

    if (!isNativeVkClient()) {
        window.open(web, "_blank", "noopener,noreferrer");
        return true;
    }

    let fallbackTimer = null;
    const onVisibilityChange = () => {
        if (document.hidden && fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
            document.removeEventListener("visibilitychange", onVisibilityChange);
        }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    try {
        window.location.href = native;
        fallbackTimer = setTimeout(() => {
            document.removeEventListener("visibilitychange", onVisibilityChange);
            try { window.location.href = web; }
            catch { window.open(web, "_blank", "noopener,noreferrer"); }
        }, 1000);
    } catch {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.location.href = web;
    }

    return true;
}

export function photoTarget(photo, fallbackOwnerId = 0) {
    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    if (!photoId || !ownerId) return "";
    return `photo${ownerId}_${photoId}`;
}

export function openVkPhoto(photo, fallbackOwnerId = 0) {
    return openVkTarget(photoTarget(photo, fallbackOwnerId));
}

export function albumTarget(album, fallbackOwnerId = 0) {
    const albumId = Number(album?.id || 0);
    const ownerId = Number(album?.owner_id || fallbackOwnerId || 0);
    if (!albumId || !ownerId) return "";
    return `album${ownerId}_${albumId}`;
}

export function albumLink(album, fallbackOwnerId = 0) {
    const target = albumTarget(album, fallbackOwnerId);
    return target ? `https://vk.com/${target}` : "";
}

export function openVkAlbum(album, fallbackOwnerId = 0) {
    return openVkTarget(albumTarget(album, fallbackOwnerId));
}
