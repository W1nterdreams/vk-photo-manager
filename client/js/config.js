export const CACHE_VERSION = "20260929-client11-albumlongpress";
export const VK_API_VERSION = "5.199";

const DEFAULT_CONFIG = {
    vk_app_id: 0,
    allowed_group_ids: [],
    home_group_id: 0,
    home_group_album_ids: [],
    blocked_group_ids: [],
    album_metadata_ttl_minutes: 30,
    album_session_fresh_seconds: 60
};

let cachedConfig = null;

function normalizePositiveIds(value) {
    const source = Array.isArray(value) ? value : [];
    const seen = new Set();
    const result = [];

    for (const raw of source) {
        const id = Number(raw);
        if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
        seen.add(id);
        result.push(id);
    }

    return result;
}

export async function loadClientConfig({ force = false } = {}) {
    if (cachedConfig && !force) return cachedConfig;

    const response = await fetch(`./config.json?v=${encodeURIComponent(CACHE_VERSION)}`, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(`Не удалось загрузить config.json (${response.status}).`);
    }

    const raw = await response.json();

    // Совместимость с самой первой клиентской версией:
    // group_id -> home_group_id, allowed_album_ids -> home_group_album_ids.
    const homeGroupId = Number(raw?.home_group_id || raw?.group_id || 0);
    const homeAlbumIds = raw?.home_group_album_ids ?? raw?.allowed_album_ids ?? [];

    cachedConfig = {
        ...DEFAULT_CONFIG,
        ...raw,
        vk_app_id: Math.max(0, Number(raw?.vk_app_id || 0)),
        allowed_group_ids: normalizePositiveIds(raw?.allowed_group_ids),
        home_group_id: Number.isInteger(homeGroupId) && homeGroupId > 0 ? homeGroupId : 0,
        home_group_album_ids: normalizePositiveIds(homeAlbumIds),
        blocked_group_ids: normalizePositiveIds(raw?.blocked_group_ids),
        album_metadata_ttl_minutes: Math.max(1, Number(raw?.album_metadata_ttl_minutes || DEFAULT_CONFIG.album_metadata_ttl_minutes)),
        album_session_fresh_seconds: Math.max(5, Number(raw?.album_session_fresh_seconds || DEFAULT_CONFIG.album_session_fresh_seconds))
    };

    return cachedConfig;
}

export function getCachedClientConfig() {
    return cachedConfig;
}

export function resolveVkAppId(config = cachedConfig) {
    const params = new URLSearchParams(window.location.search);
    const launchAppId = Number(params.get("vk_app_id") || 0);
    if (Number.isInteger(launchAppId) && launchAppId > 0) return launchAppId;

    const configured = Number(config?.vk_app_id || 0);
    if (Number.isInteger(configured) && configured > 0) return configured;

    throw new Error("Не удалось определить VK App ID. Откройте приложение из VK или укажите vk_app_id в config.json.");
}
