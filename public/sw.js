self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "3FDP alert";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "Open the app for details.",
    icon: "/icon.png",
    badge: "/icon.png",
    tag: data.tag || "3fdp-alert",
    data: { url: data.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    const existing = clientList.find((client) => client.url.includes(self.location.origin));
    if (existing) {
      existing.focus();
      return existing.navigate(url);
    }
    return clients.openWindow(url);
  }));
});
