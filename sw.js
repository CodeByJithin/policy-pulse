const CACHE_NAME = "my-app-cache-v1";

const urlsToCache = [
  "./",
  "./index.html",
  "./customer-details.html",
  "./customer.html",
  "./login.html",
  "./payments.html",
  "./policies.html",
  "./premiums.html",
  "./reminders.html",
  "./reports.html",
  "./reset-password.html",
  "./settings.html",

  "./css/components.css",
  "./css/dashboard.css",
  "./css/global.css",
  "./css/responsive.css",
  "./css/variables.css",

  "./js/app.js",
  "./js/auth.js",
  "./js/customers.js",
  "./js/dashboard.js",
  "./js/env.example.js",
  "./js/followups.js",
  "./js/payements.js",
  "./js/policies.js",
  "./js/premiums.js",
  "./js/reports.js",
  "./js/supbase.js",
  "./js/utils.js",
  "./js/whatsapp.js",


  "./manifest.json",

  "./img/fee-pulse-192.png",
  "./img/fee-pulse-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});