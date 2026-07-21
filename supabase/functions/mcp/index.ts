import { handleMcpHttpRequest } from "./http.ts";

Deno.serve((request) => handleMcpHttpRequest(request));
