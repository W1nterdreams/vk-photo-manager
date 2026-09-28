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

export function photoTarget(photo, fallbackOwnerId = 0) {
    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    if (!photoId || !ownerId) return "";
    return `photo${ownerId}_${photoId}`;
}

export function openVkPhoto(photo, fallbackOwnerId = 0) {
    const target = photoTarget(photo, fallbackOwnerId);
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
