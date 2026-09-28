import { VK_API_VERSION, resolveVkAppId } from "./config.js?v=20260928-client03-groups";
import { state } from "./state.js?v=20260928-client03-groups";
import { dom } from "./dom.js?v=20260928-client03-groups";
import { logError } from "./helpers.js?v=20260928-client03-groups";

let apiStats = { startedAt: Date.now(), total: 0, methods: {}, errors: {} };

function record(method) {
    const key = String(method || "unknown");
    apiStats.total += 1;
    apiStats.methods[key] = Number(apiStats.methods[key] || 0) + 1;
}

function recordError(method) {
    const key = String(method || "unknown");
    apiStats.errors[key] = Number(apiStats.errors[key] || 0) + 1;
}

export function getVkApiStats() {
    return JSON.parse(JSON.stringify(apiStats));
}

export function resetVkApiStats() {
    apiStats = { startedAt: Date.now(), total: 0, methods: {}, errors: {} };
    return getVkApiStats();
}

export async function vkInit() {
    await window.vkBridge.send("VKWebAppInit");
}

export async function loadUser() {
    const user = await window.vkBridge.send("VKWebAppGetUserInfo");
    state.currentUser = user;
    if (dom.user) {
        dom.user.textContent = `${user.first_name || ""} ${user.last_name || ""}`.trim() || "Пользователь";
    }
    return user;
}

export async function getAccessToken() {
    const appId = resolveVkAppId(state.config);
    const result = await window.vkBridge.send("VKWebAppGetAuthToken", {
        app_id: appId,
        scope: "photos"
    });

    state.accessToken = result?.access_token || "";
    if (!state.accessToken) throw new Error("VK не вернул access token.");
    return state.accessToken;
}

export async function vkApi(method, params = {}) {
    if (!state.accessToken) throw new Error("Нет access token.");
    record(method);

    try {
        const result = await window.vkBridge.send("VKWebAppCallAPIMethod", {
            method,
            params: {
                ...params,
                access_token: state.accessToken,
                v: VK_API_VERSION
            }
        });

        if (result?.error) throw result.error;
        if (!result || typeof result.response === "undefined") {
            throw new Error("VK API не вернул response.");
        }
        return result.response;
    } catch (error) {
        recordError(method);
        logError(`VK API ${method}:`, error);
        throw error;
    }
}

if (typeof window !== "undefined") {
    window.vkApiDebug = {
        stats: getVkApiStats,
        reset: resetVkApiStats
    };
}
