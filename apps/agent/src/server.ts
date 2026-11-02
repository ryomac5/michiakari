import { serve } from "@hono/node-server";
import { createApp } from "./app.ts";
import { defaultPort } from "./config.ts";

const port = Number(process.env.PORT ?? defaultPort);

serve({ fetch: createApp().fetch, port }, (info) => {
  console.log(`agent listening on http://localhost:${info.port}`);
});
