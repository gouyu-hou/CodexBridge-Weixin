# Admin Write Token Design

## Goal

Require the per-process Weixin administration token for every HTTP operation
that can change service state, regardless of whether the caller sends browser
`Origin` or Fetch Metadata headers.

## Current Gap

The server currently performs token checks inside the browser-origin protection
path and separately lists a few POST routes that require an explicit token.
Requests without browser headers can therefore reach other mutating routes
without presenting the token. The page-close GET beacon is also a state-changing
request and must be covered.

## Selected Approach

Add one centralized mutation predicate at the beginning of request dispatch:

- require a token for `POST`, `PUT`, `PATCH`, and `DELETE` requests;
- require a token for `GET /api/page/close` because it schedules service shutdown;
- keep `GET`, `HEAD`, and `OPTIONS` read-only routes available without a token;
- retain the existing `x-codexbridge-admin-token` header and the query-token
  fallback for the GET close beacon;
- keep the existing origin and cross-site checks, but remove their duplicated
  mutation-token responsibility.

The token comparison remains constant-time through the existing helper. Missing
or invalid credentials always return HTTP 403 with the existing sanitized error
message before any handler runs.

## Compatibility

The React admin API already sends the token header for all requests. Existing
GET close-beacon callers must append `adminToken` to the URL; ordinary POST
close calls continue using the header. No persisted data, token format, or UI
surface changes.

## Testing

Add server tests proving that a no-header/no-origin request is rejected for
representative POST, PATCH, DELETE, and GET close-beacon mutations, and that a
valid token authorizes them. Assert handlers are not invoked on rejected
requests. Keep the existing cross-origin and browser-origin tests.
