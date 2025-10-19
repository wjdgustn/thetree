self.addEventListener('push', e => {
    const data = e.data?.json() || {};
    switch(data.type) {
        case 'notification': {
            if(data.notification?.title)
                e.waitUntil(self.registration.showNotification(data.notification.title, data.notification.options ?? {}));
            break;
        }
    }
});

self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(clients.openWindow(e.notification.data?.url || '/'));
});