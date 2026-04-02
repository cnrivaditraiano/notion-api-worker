
import type {
  CollectionType,
  HandlerRequest,
  NotionBlockRecord,
  RowContentType,
  RowType,
} from "../notion-api/types";
import {
  fetchNotionUsers,
  fetchPageById,
  fetchTableData,
} from "../notion-api/notion";
import { getNotionValue } from "../notion-api/utils";
import { getNotionToken } from "../utils/index";
import { createResponse } from "../utils/response";
type Row = { id: string; [key: string]: RowContentType };

/** Normalize a Notion block record that may have double-nested value */
function normalizeBlock(block?: NotionBlockRecord): RowType | null {
  const val = block?.value;
  if (!val) {
    return null;
  }
  if ("value" in val && !("properties" in val)) {
    return { ...block, value: val.value } as RowType;
  }
  return block as RowType;
}

type MaybeNestedValue<T> = T | { value: T };

const unwrapValue = <T>(value: MaybeNestedValue<T>): T => {
  return "value" in (value as object) ? (value as { value: T }).value : (value as T);
};

const normalizeCollection = (
  collection: { value: MaybeNestedValue<CollectionType["value"]> }
): CollectionType => {
  return { ...collection, value: unwrapValue(collection.value) } as CollectionType;
};

const normalizeCollectionView = (
  view: { value: MaybeNestedValue<{ id: string }> }
): { value: { id: string } } => {
  return { ...view, value: unwrapValue(view.value) };
};

const getFirstCollection = (
  collectionMap?: Record<string, { value: MaybeNestedValue<CollectionType["value"]> }>
) => {
  if (!collectionMap) {
    return null;
  }

  for (const entry of Object.values(collectionMap)) {
    const normalized = normalizeCollection(entry);
    if (normalized?.value?.id) {
      return normalized;
    }
  }

  return null;
};

const getFirstCollectionView = (
  collectionViewMap?: Record<string, { value: MaybeNestedValue<{ id: string }> }>,
  preferredViewIds?: string[]
) => {
  if (!collectionViewMap) {
    return null;
  }

  if (preferredViewIds?.length) {
    for (const viewId of preferredViewIds) {
      const view = collectionViewMap[viewId];
      if (view) {
        const normalized = normalizeCollectionView(view);
        if (normalized?.value?.id) {
          return normalized;
        }
      }
    }
  }

  for (const entry of Object.values(collectionViewMap)) {
    const normalized = normalizeCollectionView(entry);
    if (normalized?.value?.id) {
      return normalized;
    }
  }

  return null;
};

const resolveCollectionContext = async (pageId: string, notionToken: string) => {
  const page = await fetchPageById(pageId, notionToken);

  let collection = getFirstCollection(page.recordMap.collection);
  let collectionView = getFirstCollectionView(page.recordMap.collection_view);

  if (collection?.value?.id && collectionView?.value?.id) {
    return { collection, collectionView };
  }

  const blocks = page.recordMap.block ?? {};
  for (const block of Object.values(blocks)) {
    const blockValue = (block as any)?.value;
    if (blockValue?.type !== "collection_view") {
      continue;
    }

    const viewIds = (blockValue.view_ids as string[] | undefined) ?? [];

    collection = getFirstCollection(page.recordMap.collection);
    collectionView = getFirstCollectionView(page.recordMap.collection_view, viewIds);

    if (!collection?.value?.id || !collectionView?.value?.id) {
      const collectionBlockPageId = (blockValue.id as string | undefined) ?? pageId;
      const collectionPage = await fetchPageById(collectionBlockPageId, notionToken);

      collection = getFirstCollection(collectionPage.recordMap.collection);
      collectionView = getFirstCollectionView(
        collectionPage.recordMap.collection_view,
        viewIds
      );
    }

    if (collection?.value?.id && collectionView?.value?.id) {
      return { collection, collectionView };
    }
  }

  return { collection: null, collectionView: null };
};

export const getTableData = async (
  collection: CollectionType,
  collectionViewId: string,
  notionToken?: string,
  raw?: boolean
) => {
  const table = await fetchTableData(
    collection.value.id,
    collectionViewId,
    notionToken
  );

  const collectionRows = collection.value.schema ?? {};
  const collectionColKeys = Object.keys(collectionRows);
  const blockIds =
    table?.result?.reducerResults?.collection_group_results?.blockIds ?? [];
  const blocks = table?.recordMap?.block ?? {};

  const tableArr: RowType[] = blockIds
    .map((id: string) => normalizeBlock(blocks[id]))
    .filter((row): row is RowType => row !== null);

  const tableData = tableArr.filter(
    (b) => b.value?.properties && b.value.parent_id === collection.value.id
  );


  const rows: Row[] = [];

  for (const td of tableData) {
    let row: Row = { id: td.value.id };

    for (const key of collectionColKeys) {
      const val = td.value.properties?.[key];
      if (val) {
        const schema = collectionRows[key];
        row[schema.name] = raw ? val : getNotionValue(val, schema.type, td);
        if (schema.type === "person" && row[schema.name]) {
          const users = await fetchNotionUsers(row[schema.name] as string[]);
          row[schema.name] = users;
        }
      }
    }
    rows.push(row);
  }

  return { rows, schema: collectionRows };
};

export async function tableRoute(c: HandlerRequest) {
  const pageId = c.req.param("pageId");
  const notionToken = getNotionToken(c);
  if (!pageId || !notionToken) {
    return createResponse(
      JSON.stringify({ error: "Invalid Notion page ID or Notion token" }),
      { headers: {}, statusCode: 400, request: c }
    );
  }
  return await getTable({ pageId, notionToken });
 
}


export async function getTable({  pageId, notionToken, }: { pageId: string; notionToken: string }): Promise<{ success: true; data: Row[] } | { success: false; error: string; data: null }> {

  const { collection, collectionView } = await resolveCollectionContext(
    pageId,
    notionToken
  );

  if (!collection?.value?.id) {
    return {
      success: false,
      error: `No table collection found on Notion page: ${pageId}`,
      data: null,
    };
  }

  if (!collectionView?.value?.id) {
    return {
      success: false,
      error: `No collection view found on Notion page: ${pageId}`,
      data: null,
    };
  }

  const data = await getTableData(
    collection,
    collectionView.value.id,
    notionToken
  );

  return {
    success: true,
    data: data.rows,

  }
}
