// Child-server integration tests only: never contact the real booking site.
globalThis.fetch = async () => new Response("", { status: 200, headers: { Date: new Date().toUTCString() } });
