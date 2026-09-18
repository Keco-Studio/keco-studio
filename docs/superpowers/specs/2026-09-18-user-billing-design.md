# User Billing Design

## Goal

Make Billing an account-level destination that can be opened from any page and whose purchases grant Credits to the signed-in user, independently of projects.

## Routing

Billing is served only at `/billing`. The avatar menu always navigates there. The project-scoped billing page at `/{projectId}/billing` is removed rather than redirected.

## Checkout

The billing UI sends only `planId` and the signed-in email to `/api/checkout`. The API validates that input, authenticates the user, and does not perform project authorization. Stripe Checkout metadata and success/cancel URLs contain no project ID, and both return to `/billing`.

## Payments

New `payment_orders` records have `project_id = null`; the column is already nullable, so no migration is required. Existing payment records retain any historical project association. Credit grants continue to use `payment_orders.user_id`.

## Error Handling

Existing validation, authentication, Stripe configuration, and payment-persistence errors retain their current client-safe responses. Removing project validation removes only project-ID and project-membership failures.

## Testing

Unit tests prove Checkout input accepts user-level payloads and rejects invalid plans or emails. Static route/navigation coverage verifies the global billing route and confirms the project billing route is absent. Existing payment persistence tests remain responsible for credit grants.
