console.log("SW FILE LOADED");

self.addEventListener("install", () => {
    console.log("SW INSTALL");
    self.skipWaiting();
});

self.addEventListener("activate", () => {
    console.log("SW ACTIVATE");
    self.clients.claim();
});