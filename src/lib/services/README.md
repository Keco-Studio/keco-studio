# Service Boundaries

Services in this directory are isomorphic modules: they accept a `SupabaseClient`
from the caller and must not depend on browser-only APIs or module state. API routes
and agent tools should reuse these services instead of duplicating database queries.

Code that creates or owns a service-role client belongs in `src/lib/server/`.
