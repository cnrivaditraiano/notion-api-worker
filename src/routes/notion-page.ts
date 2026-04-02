import { fetchPageById, fetchBlocks } from "../notion-api/notion";
import {
  normalizeBlockMap,
  normalizeCollectionRecord,
  normalizeCollectionViewRecord,
} from "../notion-api/normalize";
import { parsePageId } from "../notion-api/utils";
import { BlockType, HandlerRequest } from "../notion-api/types";
import { getTableData } from "./table";
import { createResponse } from "../utils/response";
import { getNotionToken } from "../utils/index";

type EnrichedBlock = BlockType & {
  collection?: unknown;
};

const getFirstCollection = (collectionMap?: Record<string, unknown>) => {
  if (!collectionMap) return null;
  for (const entry of Object.values(collectionMap)) {
    const collection = normalizeCollectionRecord(entry);
    if (collection) return collection;
  }
  return null;
};

const getFirstCollectionView = (collectionViewMap?: Record<string, unknown>) => {
  if (!collectionViewMap) return null;
  for (const entry of Object.values(collectionViewMap)) {
    const view = normalizeCollectionViewRecord(entry);
    if (view) return view;
  }
  return null;
};

const collectMissingChildBlockIds = (
  allBlocks: Record<string, EnrichedBlock>,
  rootPageId: string
) => {
  return Object.keys(allBlocks).flatMap((blockId) => {
    const block = allBlocks[blockId];
    const content = block.value?.content;

    if (!content || (block.value.type === "page" && blockId !== rootPageId)) {
      return [];
    }

    return content.filter((id) => !allBlocks[id]);
  });
};

const buildPageBlockMap = async (pageId: string, notionToken: string) => {
  const page = await fetchPageById(pageId, notionToken);
  let allBlocks: Record<string, EnrichedBlock> = {
    ...normalizeBlockMap(page.recordMap.block as Record<string, unknown>),
  };

  while (true) {
    const pendingBlocks = collectMissingChildBlockIds(allBlocks, pageId);
    if (!pendingBlocks.length) {
      break;
    }

    const newBlocks = await fetchBlocks(pendingBlocks, notionToken).then((res) =>
      normalizeBlockMap(res.recordMap.block as Record<string, unknown>)
    );

    allBlocks = { ...allBlocks, ...newBlocks };
  }

  return { page, allBlocks };
};

const enrichCollectionBlocks = async (
  page: Awaited<ReturnType<typeof fetchPageById>>,
  allBlocks: Record<string, EnrichedBlock>,
  notionToken: string
) => {
  const pageCollection = getFirstCollection(page.recordMap.collection as Record<string, unknown>);
  const pageCollectionView = getFirstCollectionView(
    page.recordMap.collection_view as Record<string, unknown>
  );

  if (!pageCollection || !pageCollectionView) {
    return allBlocks;
  }

  const collectionViewBlockIds = Object.keys(allBlocks).filter(
    (blockId) => allBlocks[blockId]?.value?.type === "collection_view"
  );

  for (const blockId of collectionViewBlockIds) {
    const collPage = await fetchPageById(blockId, notionToken);
    const coll = getFirstCollection(collPage.recordMap.collection as Record<string, unknown>);
    const collView = getFirstCollectionView(
      collPage.recordMap.collection_view as Record<string, unknown>
    );

    if (!coll || !collView) {
      continue;
    }

    const { rows, schema } = await getTableData(
      coll,
      collView.value.id,
      notionToken,
      true
    );

    const viewIds = (allBlocks[blockId].value as { view_ids?: string[] }).view_ids ?? [];
    const types = viewIds
      .map((id) => normalizeCollectionViewRecord(collPage.recordMap.collection_view?.[id]))
      .map((view) => view?.value)
      .filter(Boolean) as unknown[];

    allBlocks[blockId] = {
      ...allBlocks[blockId],
      collection: {
        title: coll.value.name,
        schema,
        types,
        data: rows,
      },
    };
  }

  return allBlocks;
};

const buildPageBlocks = async (pageId: string, notionToken: string) => {
  const { page, allBlocks } = await buildPageBlockMap(pageId, notionToken);
  return enrichCollectionBlocks(page, allBlocks, notionToken);
};

export async function pageRoute(c: HandlerRequest) {
  const pageId = parsePageId(c.req.param("pageId"));
  const notionToken = getNotionToken(c);
  if(!notionToken || !pageId) {
    return createResponse({ error: "Invalid Notion page ID or Notion token" }, { statusCode: 400, request: c });
  }

  const allBlocks = await buildPageBlocks(pageId, notionToken);

  return createResponse(allBlocks, {
    request: c,
  });
}

export async function getPageBlocks({ pageId, notionToken }: { pageId: string; notionToken: string }) {
  return await buildPageBlocks(pageId, notionToken);
}