
    /**
     * @template {AdminJson} T
     * @param {string} url
     * @param {AdminRequestOptions} [options]
     * @returns {Promise<T>}
     */
    async function requestJson(url, options = {}) {
      const requestedHeaders = (options && options.headers) || {};
      const res = await fetch(url, {
        ...options,
        headers: {
          'content-type': 'application/json',
          'x-codexbridge-admin-token': ADMIN_TOKEN,
          ...requestedHeaders
        }
      });
      const data = /** @type {T & { error?: string }} */ (
        await res.json().catch(() => ({}))
      );
      if (!res.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }
      return data;
    }
