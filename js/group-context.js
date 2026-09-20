import { state } from "./state.js?v=20260920-albumtools08";
import { vkApi } from "./vk-api.js?v=20260920-albumtools08";

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
 * Инициализация контекста сообщества.
 *
 * ВАЖНО:
 * Для методов photos.* фотографии сообщества запрашиваются
 * через отрицательный owner_id:
 *
 * group_id = 123456
 * owner_id = -123456
 */
export async function initGroupContext() {
    const groupId = readGroupIdFromLaunchParams();

    console.log("FULL URL:", window.location.href);
    console.log("VK GROUP ID:", groupId);

    if (!groupId) {
        throw new Error(
            "Не найден vk_group_id. " +
            "Откройте Mini App из сообщества VK, которым нужно управлять."
        );
    }

    /*
     * Сразу создаём контекст.
     *
     * Не блокируем работу приложения по is_admin/admin_level.
     * В частности, владелец сообщества не должен отсеиваться
     * только потому, что VK вернул неожидаемое значение этих полей.
     */
    state.group = {
        id: groupId,

        // Для photos.getAlbums, photos.get и других photos.*
        ownerId: -Math.abs(groupId),

        name: "",
        isAdmin: false,
        adminLevel: 0
    };

    /*
     * Получаем информацию о сообществе.
     *
     * Если этот запрос по какой-либо причине не даст информацию
     * о правах, само приложение всё равно сможет продолжить работу.
     */
    try {
        const response = await vkApi("groups.getById", {
            group_id: groupId,
            fields: "name,is_admin,admin_level"
        });

        console.log("groups.getById response:", response);

        const group =
            Array.isArray(response)
                ? response[0]
                : (
                    response?.groups?.[0] ||
                    response?.items?.[0] ||
                    response
                );

        if (group) {
            state.group.name = group.name || "";

            state.group.isAdmin =
                group.is_admin === 1 ||
                group.is_admin === true;

            state.group.adminLevel =
                Number(group.admin_level || 0);
        }

    } catch (error) {
        /*
         * Ошибка получения дополнительной информации о группе
         * не должна переключать приложение обратно на личный профиль
         * и не должна уничтожать уже известный groupId.
         */
        console.warn(
            "Не удалось получить дополнительную информацию о сообществе:",
            error
        );
    }

    console.log("GROUP CONTEXT:", state.group);
    console.log("GROUP ID:", state.group.id);
    console.log("PHOTO OWNER ID:", state.group.ownerId);

    return state.group;
}


/**
 * Положительный ID сообщества.
 *
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
 *
 * Например:
 *
 * group_id = 123456
 * owner_id = -123456
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
    if (!state.group?.id) {
        throw new Error(
            "Контекст сообщества не инициализирован."
        );
    }

    return state.group;
}
