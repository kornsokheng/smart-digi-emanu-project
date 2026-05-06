export function api(path, options) {
    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";

    return fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers || {}),
        },
    });
}
