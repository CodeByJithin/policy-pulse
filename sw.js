const CACHE_NAME = "policy-pulse-v2";

const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",

  "/pages/dashboard.html",
  "/pages/login.html",
  "/pages/customer.html",
  "/pages/customer-details.html",
  "/pages/payments.html",
  "/pages/policies.html",
  "/pages/premiums.html",
  "/pages/reminders.html",
  "/pages/reports.html",
  "/pages/reset-password.html",
  "/pages/settings.html",

  "/css/components.css",
  "/css/dashboard.css",
  "/css/global.css",
  "/css/responsive.css",
  "/css/variables.css",

  "/js/app.js",
  "/js/auth.js",
  "/js/customers.js",
  "/js/dashboard.js",
  "/js/env.example.js",
  "/js/followups.js",
  "/js/payements.js",
  "/js/policies.js",
  "/js/premiums.js",
  "/js/reports.js",
  "/js/supabase.js",
  "/js/utils.js",
  "/js/whatsapp.js",

  "/img/policy-pulse-192.png",
  "/img/policy-pulse-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});