import { onlineApi } from "./online-api";
import type { Database } from "./store";
interface Env {
  DB: Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}
export default {
  async fetch(request: Request, env: Env) {
    if (new URL(request.url).pathname.startsWith("/api/online/"))
      return onlineApi(request, env.DB);
    return env.ASSETS.fetch(request);
  },
};
