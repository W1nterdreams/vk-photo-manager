function isNativeVkClient() {
    return Boolean(
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
        window.location.href = native;

        fallbackTimer = setTimeout(() => {
            clearFallback();
            try {
                window.location.href = web;
            } catch (_) {
                window.open(web, "_blank", "noopener,noreferrer");
            }
        }, 900);
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
