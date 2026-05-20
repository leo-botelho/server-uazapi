// open-next.config.ts — required by @opennextjs/cloudflare
import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // For best results consider enabling R2 caching:
  // https://opennext.js.org/cloudflare/caching
});
