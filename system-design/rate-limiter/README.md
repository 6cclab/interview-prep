# Design: Rate Limiter for a Public API

Design a rate limiter for a public API platform, similar in spirit to what sits in
front of Stripe's or GitHub's API.

## Requirements

- Every API request is authenticated and carries a client identifier (an API key or
  OAuth client ID).
- Each client is assigned a request quota, e.g. "100 requests per minute." Quotas
  differ by client tier.
- There is also a global limit protecting the backend as a whole, independent of any
  single client's quota — the aggregate of many well-behaved clients should not be
  able to take the system down.
- A client that exceeds its quota gets a clear, correct response, not an
  approximation. The response should tell the client when it can retry.
- The limiter sits in front of many stateless API server instances (assume dozens,
  scaling with traffic) behind a load balancer. It must produce the same answer
  regardless of which instance a given request lands on.
- The limiter itself must not become the platform's bottleneck or its single point
  of failure. It adds latency to every request; that latency budget is small.

## Scale to design for

- 50,000 requests/second sustained across the platform, with bursts to 3x that
  during traffic spikes.
- 200,000 distinct active clients, with a long tail — a small number of clients
  responsible for a large share of traffic.
- Client quotas range from 10 req/min (free tier) to 50,000 req/min (enterprise
  tier).

## What the interviewer wants covered

- What happens to a request that exceeds its limit: rejected, queued, or shaped —
  and why that choice for this system.
- How the limiter enforces a single client's quota correctly when requests for that
  client are arriving at multiple, independent API server instances at once.
- The tradeoff between different limiting algorithms — you should be able to name
  more than one, explain how each behaves at the boundary of a time window, and say
  what each costs to run at this scale.
- What a client sees in the response when they're over the limit or approaching it.
- What happens to enforcement if the component that tracks request counts becomes
  slow or unavailable.
- Where this system sits in the request path, and what it costs in added latency.

## Out of scope (say so, don't design it)

- Authentication/authorization itself — assume the client identity is already
  resolved before the limiter sees the request.
- Billing or usage metering for invoicing purposes — this is about enforcement in
  the request path, not analytics.
