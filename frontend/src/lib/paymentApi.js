const PRODUCTION_API_BASE_URL = "https://smart-digi-emanu-project.onrender.com";

function resolveApiBaseUrl() {
    if (import.meta.env.VITE_API_BASE_URL) {
        return import.meta.env.VITE_API_BASE_URL;
    }
    if (typeof window !== "undefined" && window.location.hostname.includes("workers.dev")) {
        return PRODUCTION_API_BASE_URL;
    }
    return "";
}

export function api(path, options) {
    const apiBaseUrl = resolveApiBaseUrl();

    return fetch(`${apiBaseUrl}${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers || {}),
        },
    });
}
