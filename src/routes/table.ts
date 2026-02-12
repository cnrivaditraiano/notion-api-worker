import {
  fetchPageById,
  fetchTableData,
  fetchNotionUsers,
} from "../notion-api/notion";
import { parsePageId, getNotionValue } from "../notion-api/utils";
import type {
  RowContentType,
  CollectionType,
  RowType,
  HandlerRequest,
} from "../notion-api/types";
import { createResponse } from "../utils/response";
import { getNotionToken } from "../utils/index";
  type Row = { id: string; [key: string]: RowContentType };

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

  const collectionRows = collection.value.schema;
  const collectionColKeys = Object.keys(collectionRows);

  const tableArr: RowType[] =
    table.result.reducerResults.collection_group_results.blockIds.map(
      (id: string) => table.recordMap.block[id]
    );

  const tableData = tableArr.filter(
    (b) =>
      b.value?.properties && b.value.parent_id === collection.value.id
  );


  const rows: Row[] = [];

  for (const td of tableData) {
    let row: Row = { id: td.value.id };

    for (const key of collectionColKeys) {
      const val = td.value.properties[key];
      if (val) {
        const schema = collectionRows[key];
        row[schema.name] = raw ? val : getNotionValue(val, schema.type, td);
        if (schema.type === "person" && row[schema.name]) {
          const users = await fetchNotionUsers(row[schema.name] as string[]);
          row[schema.name] = users as any;
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

  const page = await fetchPageById(pageId, notionToken);
  if (!page.recordMap.collection)
    return {
      success: false,
      error: `No table found on Notion page: ${pageId}`,
      data: null
    }
    

  const collection = Object.keys(page.recordMap.collection).map(
    (k) => page.recordMap.collection[k]
  )[0];

  const collectionView: {
    value: { id: CollectionType["value"]["id"] };
  } = Object.keys(page.recordMap.collection_view).map(
    (k) => page.recordMap.collection_view[k]
  )[0];
  console.log(`Fetched collection and view for page ${pageId}:`, { collection, collectionView });

  const data = await getTableData(
    collection,
    collectionView.value.id,
    notionToken
  );
  console.log(`Processed table data:`, data);

  return {
    success: true,
    data: data.rows,

  }
}
