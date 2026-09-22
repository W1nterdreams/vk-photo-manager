import { state } from "./state.js?v=20260922-adminonly28";
import { vkApi } from "./vk-api.js?v=20260922-adminonly28";

const ADMIN_ROLE = "admin";
const ADMIN_LEVEL = 3;

export class GroupAccessDeniedError extends Error {
    constructor(message, code = "GROUP_ACCESS_DENIED") {
        super(message);
        this.name = "GroupAccessDeniedError";
        this.code = code;
    }
}

/**
 * Получает ID сообщества из параметров запуска VK Mini Apps.
 */
function readGroupIdFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);

    const raw =
        params.get("vk_group_id") ||
        params.get("group_id");

    const id = Number(raw);

    return Number.isInteger(id) && id > 0
        ? id
        : null;
}

/**
 * Роль пользователя в сообществе, которую VK передал при запуске Mini App.
 * Возможные штатные значения: admin / editor / moder / member / none.
 *
 * Этот параметр используем только как ранний фильтр. Окончательное решение
 * всегда подтверждаем через groups.getById.
 */
function readViewerGroupRoleFromLaunchParams() {
    const params = new URLSearchParams(window.location.search);
    const role = String(params.get("vk_viewer_group_role") || "")
        .trim()
        .toLowerCase();

    return role || null;
}

function getLaunchContext() {
    return {
        groupId: readGroupIdFromLaunchParams(),
        viewerGroupRole: readViewerGroupRoleFromLaunchParams()
    };
}

/**
 * Ранняя проверка до получения access token и загрузки данных приложения.
 *
 * Если VK уже явно сообщил, что пользователь editor/moder/member/none,
 * дальше приложение не запускаем и лишние рабочие запросы не делаем.
 * Если роль отсутствует, продолжаем до обязательной проверки groups.getById.
 */
export function precheckLaunchGroupAccess() {
    const { groupId, viewerGroupRole } = getLaunchContext();

    if (!groupId) {
        throw new Error(
            "Не найден vk_group_id. " +
            "Откройте Mini App из сообщества VK, которым нужно управлять."
        );
    }

    if (viewerGroupRole && viewerGroupRole !== ADMIN_ROLE) {
        throw new GroupAccessDeniedError(
            "Доступ к приложению разрешён только владельцу и администраторам сообщества."
        );
    }

    return {
        groupId,
        viewerGroupRole
    };
}

/**
 * Инициализация контекста сообщества и обязательная проверка прав.
 *
 * Для работы приложения разрешаем только уровень administrator (3).
 * Редакторы (2), модераторы (1), участники и остальные пользователи
 * не получают доступ к рабочему интерфейсу.
 */
export async function initGroupContext() {
    const { groupId, viewerGroupRole } = precheckLaunchGroupAccess();

    console.log("FULL URL:", window.location.href);
    console.log("VK GROUP ID:", groupId);
    console.log("VK VIEWER GROUP ROLE:", viewerGroupRole);

    state.group = {
        id: groupId,

        // Для photos.getAlbums, photos.get и других photos.*
        ownerId: -Math.abs(groupId),

        name: "",
        isAdmin: false,
        adminLevel: 0,
        viewerGroupRole,
        accessGranted: false
    };

    let response;

    try {
        response = await vkApi("groups.getById", {
            group_id: groupId,
            fields: "name,is_admin,admin_level"
        });
    } catch (error) {
        console.warn("Не удалось подтвердить права администратора:", error);

        throw new GroupAccessDeniedError(
            "Не удалось подтвердить права администратора сообщества. " +
            "Работа приложения временно заблокирована. Попробуйте открыть его позже.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    console.log("groups.getById response:", response);

    const group =
        Array.isArray(response)
            ? response[0]
            : (
                response?.groups?.[0] ||
                response?.items?.[0] ||
                response
            );

    if (!group) {
        throw new GroupAccessDeniedError(
            "VK не вернул данные сообщества для проверки прав.",
            "GROUP_ACCESS_CHECK_FAILED"
        );
    }

    state.group.name = group.name || "";
    state.group.isAdmin =
        group.is_admin === 1 ||
        group.is_admin === true;
    state.group.adminLevel = Number(group.admin_level || 0);

    const hasAdministratorAccess =
        state.group.isAdmin === true &&
        state.group.adminLevel === ADMIN_LEVEL;

    if (!hasAdministratorAccess) {
        throw new GroupAccessDeniedError(
            "Доступ к приложению разрешён только владельцу и администраторам сообщества."
        );
    }

    state.group.accessGranted = true;

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);
    console.log("GROUP ACCESS: administrator");

    return state.group;
}

/**
 * Положительный ID сообщества.
 * Используется, например, там, где VK API требует group_id.
 */
export function getGroupId() {
    const groupId = Number(state.group?.id);

    if (!Number.isInteger(groupId) || groupId <= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует group_id."
        );
    }

    return groupId;
}

/**
 * Отрицательный ID владельца фотографий сообщества.
 */
export function getOwnerId() {
    const ownerId = Number(state.group?.ownerId);

    if (!Number.isInteger(ownerId) || ownerId >= 0) {
        throw new Error(
            "Контекст сообщества не инициализирован: отсутствует owner_id."
        );
    }

    return ownerId;
}

/**
 * Возвращает текущий контекст сообщества.
 */
export function getGroupContext() {
    if (!state.group?.id || state.group?.accessGranted !== true) {
        throw new Error(
            "Контекст сообщества не инициализирован или доступ не подтверждён."
        );
    }

    return state.group;
}
