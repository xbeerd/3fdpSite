self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "3FDP alert";
  const badgePromise = "setAppBadge" in navigator ? navigator.setAppBadge(1).catch(() => {}) : Promise.resolve();
  const notificationPromise = self.registration.showNotification(title, {
    body: data.body || "Open the app for details.",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: data.tag || "3fdp-alert",
    data: { url: data.url || "/" }
  });
  event.waitUntil(Promise.all([badgePromise, notificationPromise]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  const clearBadge = "clearAppBadge" in navigator ? navigator.clearAppBadge().catch(() => {}) : Promise.resolve();
  event.waitUntil(clearBadge.then(() => clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    const existing = clientList.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      existing.postMessage({ type: "notification-click", url });
      existing.focus();
      return existing.navigate(url);
    }
    return clients.openWindow(url);
  })));
});
