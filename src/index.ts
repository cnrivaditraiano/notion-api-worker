import { Hono } from "hono";
import type { Context } from "hono";

import { parsePageId } from "./notion-api/utils";
import { getPageBlocks } from "./routes/notion-page";
import { getTable, tableRoute } from "./routes/table";
import { env } from "cloudflare:workers"
import { cache } from 'hono/cache'

import { getNotionToken } from "./utils";
const cacheSettings = cache({
    
  cacheName: 'notion-cache',
  cacheControl: 'public, s-maxage=604800, max-age=0, must-revalidate',
});
const addCacheTags = (c: Context, tags: string[]) => {
    c.header('Cache-Tag', ["global-blog", ...tags].join(', '));
}
const app = new Hono().basePath("/v1");
app.use("*", cacheSettings);

app.get("/page/:pageId", async (c) => {
    const pageId = parsePageId(c.req.param("pageId"));
    const notionToken = getNotionToken(c);
    if(!notionToken || !pageId) {
        return c.json({ error: "Invalid Notion page ID or Notion token" }, 400);
    }
    addCacheTags(c, [`blog-page-${pageId}`, "blog-pages"]);
    return c.json(await getPageBlocks({ pageId, notionToken }));
});

app.get("/table/:tableId", async (c) => {
    const tableId = parsePageId(c.req.param("tableId"));
    const notionToken = getNotionToken(c);
    if(!notionToken || !tableId) {
        return c.json({ error: "Invalid Notion table ID or Notion token" }, 400);
    }
    const res = await getTable({ pageId: tableId, notionToken });
    if(!res.success) {
        return c.json({ error: res.error }, 400);
    }
    addCacheTags(c, [`blog-table-${tableId}`, "blog-tables"]);
    return c.json(res.data);

});
app.get("/table", async (c) => {
    const tableId = parsePageId(env.NOTION_DATABASE_ID);
    const res = await getTable({ pageId: tableId, notionToken: env.NOTION_TOKEN });
    if(!res.success) {
        return c.json({ error: res.error }, 400);
    }
    addCacheTags(c, ["blog-table-all"]);
    return c.json(res.data);
});



export default app;
