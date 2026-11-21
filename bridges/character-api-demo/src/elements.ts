export function byId<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Нет элемента #${id}`);
    return element as T;
}
