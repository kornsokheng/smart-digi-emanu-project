export function api(path, options) {
    return fetch(path, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers || {}),
        },
    });
}
