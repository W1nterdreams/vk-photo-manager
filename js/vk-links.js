function isMobileDevice() {
    const ua = String(navigator.userAgent || "");
    return /Android|iPhone|iPad|iPod/i.test(ua);
}

function isNativeVkClient() {
    return Boolean(
        isMobileDevice() ||
        window.AndroidBridge ||
        window.webkit?.messageHandlers?.VKWebAppClose ||
        window.ReactNativeWebView
    );
}

function targetToUrls(target) {
    const raw = String(target || "").trim();

    if (/^id\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^(club|public)\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^photo-?\d+_\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^https?:\/\/vk\.(com|ru)\//i.test(raw)) {
        const path = raw.replace(/^https?:\/\/vk\.(com|ru)\//i, "");
        return {
            web: raw,
            native: `vk://vk.com/${path}`
        };
    }

    return {
        web: `https://vk.com/${raw}`,
        native: `vk://vk.com/${raw}`
    };
}

export function profileTargetFromId(id) {
    const n = Number(id || 0);
    if (n > 0) return `id${n}`;
    if (n < 0) return `club${Math.abs(n)}`;
    return "";
}

export function photoTarget(photo, fallbackOwnerId = 0) {
    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    if (!photoId || !ownerId) return "";
    return `photo${ownerId}_${photoId}`;
}

export function openVkTarget(target) {
    const { web, native } = targetToUrls(target);

    if (!isNativeVkClient()) {
        window.open(web, "_blank", "noopener,noreferrer");
        return;
    }

    let fallbackTimer = null;

    const clearFallback = () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
        document.removeEventListener("visibilitychange", onVisibilityChange);
    };

    const onVisibilityChange = () => {
        if (document.hidden) clearFallback();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    try {
        // На телефоне сначала принудительно пробуем нативную схему VK.
        window.location.href = native;

        fallbackTimer = setTimeout(() => {
            clearFallback();
            try {
                window.location.href = web;
            } catch (_) {
                window.open(web, "_blank", "noopener,noreferrer");
            }
        }, 1000);
    } catch (_) {
        clearFallback();
        window.location.href = web;
    }
}

export function openVkProfile(id) {
    const target = profileTargetFromId(id);
    if (!target) return;
    openVkTarget(target);
}

export function openVkPhoto(photo, fallbackOwnerId = 0) {
    const target = photoTarget(photo, fallbackOwnerId);
    if (!target) return;
    openVkTarget(target);
}
