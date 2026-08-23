# Weixin Admin Server Services Design

## Goal

Split the Weixin admin backend into focused routing, backup transaction, diagnostics, and log-maintenance units without changing the HTTP API.

## Components

### Request Router

A route resolver maps HTTP method and normalized pathname to a discriminated route with decoded parameters. A dispatcher invokes injected handlers. Authentication remains ahead of protected dispatch, static asset handling remains explicit, and unmatched routes keep the existing response.

### Backup Service

A backup service owns export collection, import validation, restore-point creation, transactional application, and rollback. Repository access is injected through a typed interface. Validation completes before the first mutation, and rollback preserves the existing error sanitization behavior.

### Diagnostics Service

A diagnostics service owns readiness and configuration checks and returns structured results to the server. It does not write HTTP responses directly.

### Log Maintenance Service

A log-maintenance service owns compaction thresholds, rotated-log expiry, manual cleanup, and scheduling. The admin server owns service lifecycle and starts/stops the scheduler.

## Server Responsibilities After Extraction

`WeixinAdminServer` keeps socket lifecycle, authorization policy, page-close shutdown coordination, bridge/service controls, pairing flow, and response serialization. It composes the four extracted services and supplies side-effect callbacks.

## Compatibility Contract

- Preserve every URL, method, status code, body shape, content type, and authorization requirement.
- Preserve route precedence for parameterized model, usage, session, and account routes.
- Preserve import validation-before-mutation and rollback ordering.
- Preserve diagnostics text and log cleanup counts.
- Do not change the React admin client.

## Tests

Add pure route-table tests, backup rollback tests, diagnostics result tests, and fake-clock log scheduling tests. Existing `WeixinAdminServer` integration tests remain the API compatibility gate.
