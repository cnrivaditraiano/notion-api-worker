import { HandlerRequest } from "../notion-api/types.js";
import { env } from "cloudflare:workers"
export const getNotionToken = (c: HandlerRequest) => {
  return (
    env.NOTION_TOKEN ||
    (c.req.header("Authorization") || "").split("Bearer ")[1] ||
    undefined
  );
};
