# Design: Notification Fanout System

Design a notification system that delivers events to users across multiple
channels — push, email, SMS, and in-app — similar in spirit to what sits behind a
"someone commented on your post" or "your order shipped" notification at a
large consumer product.

## Requirements

- An event occurs somewhere in the product (a comment, a mention, an order status
  change, a price drop on a watched item). The system decides who should be
  notified, on which channels, and delivers it.
- Some events target a single user (your order shipped). Some target a large
  audience at once (a creator with millions of followers posts; a broadcast
  announcement to all users of a feature).
- Each user has per-channel preferences (e.g. push for comments, email for weekly
  digests, nothing for X) and quiet hours during which non-urgent notifications
  should not interrupt them.
- Delivery goes through third-party providers for push (e.g. APNs/FCM), email
  (e.g. an ESP), and SMS (e.g. a carrier gateway). These providers have their own
  rate limits, latency, and failure characteristics, outside your control.
- A user should not receive the same notification twice for the same underlying
  event, even if something upstream retries or a delivery attempt is ambiguous.
- The product wants to know, per notification, whether it was delivered — not just
  whether it was "sent" to a provider.

## Scale to design for

- 500 million registered users.
- 20,000 notification-triggering events per second at peak, most single-user, but
  with occasional large-fanout events where one event targets 5-10 million users
  within a short window (a viral post, a major announcement).
- Users average 2.5 enabled channels each.

## What the interviewer wants covered

- How a single event becomes potentially millions of individual per-user
  deliveries without the fanout step itself becoming the bottleneck or taking
  minutes to complete.
- How per-user preferences and quiet hours are evaluated before a notification
  goes out, and where that evaluation happens in the pipeline.
- How duplicate delivery is prevented when retries happen at any layer.
- What "delivered" means precisely, and how the system tracks it per channel given
  that push/email/SMS providers have different notions of delivery confirmation.
- What the system does when a third-party provider is down, slow, or rate-limiting
  you — for each channel, not just in general.
- The retry strategy and how it interacts with idempotency and ordering.

## Out of scope (say so, don't design it)

- The in-app notification *feed UI* itself (pagination, read/unread state
  rendering) — focus on getting the notification delivered/stored, not the
  client-side display.
- Building your own push/SMS infrastructure — assume third-party providers for the
  actual wire-level delivery to devices/carriers.
