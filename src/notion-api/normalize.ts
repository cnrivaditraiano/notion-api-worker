import * as v from "valibot";
import type { BlockType, CollectionType, NotionBlockRecord, RowType } from "./types";

const RecordSchema = v.object({
  value: v.unknown(),
  role: v.optional(v.string()),
});

const CollectionSchema = v.object({
  id: v.string(),
  schema: v.record(v.string(), v.unknown()),
  name: v.optional(v.array(v.array(v.string()))),
});

const CollectionViewSchema = v.object({
  id: v.string(),
});

const BlockSchema = v.object({
  id: v.string(),
  type: v.string(),
  content: v.optional(v.array(v.string())),
  view_ids: v.optional(v.array(v.string())),
  collection_id: v.optional(v.string()),
});

const RowValueSchema = v.object({
  id: v.string(),
  parent_id: v.string(),
  properties: v.record(v.string(), v.unknown()),
});

type NormalizedRecord = { value: unknown; role?: string };

const unwrapNestedRecord = (input: unknown): NormalizedRecord | null => {
  const outer = v.safeParse(RecordSchema, input);
  if (!outer.success) {
    return null;
  }

  const nested = v.safeParse(RecordSchema, outer.output.value);
  if (nested.success) {
    return {
      value: nested.output.value,
      role: outer.output.role ?? nested.output.role,
    };
  }

  return {
    value: outer.output.value,
    role: outer.output.role,
  };
};

export const normalizeBlockRecord = (block: unknown): (BlockType & { collection?: unknown }) | null => {
  const normalized = unwrapNestedRecord(block);
  if (!normalized) {
    return null;
  }

  const parsed = v.safeParse(BlockSchema, normalized.value);
  if (!parsed.success) {
    return null;
  }

  return {
    role: normalized.role ?? "reader",
    value: normalized.value as BlockType["value"],
  };
};

export const normalizeBlockMap = (blocks: Record<string, unknown> = {}) => {
  const normalized: Record<string, BlockType & { collection?: unknown }> = {};

  for (const [id, block] of Object.entries(blocks)) {
    const parsed = normalizeBlockRecord(block);
    if (parsed) {
      normalized[id] = parsed;
    }
  }

  return normalized;
};

export const normalizeCollectionRecord = (record: unknown): CollectionType | null => {
  const normalized = unwrapNestedRecord(record);
  if (!normalized) {
    return null;
  }

  const parsed = v.safeParse(CollectionSchema, normalized.value);
  if (!parsed.success) {
    return null;
  }

  return {
    value: normalized.value as CollectionType["value"],
  };
};

export const normalizeCollectionViewRecord = (record: unknown): { value: { id: string } } | null => {
  const normalized = unwrapNestedRecord(record);
  if (!normalized) {
    return null;
  }

  const parsed = v.safeParse(CollectionViewSchema, normalized.value);
  if (!parsed.success) {
    return null;
  }

  return {
    value: {
      id: parsed.output.id,
    },
  };
};

export const normalizeRowRecord = (record?: NotionBlockRecord): RowType | null => {
  if (!record) {
    return null;
  }

  const normalized = unwrapNestedRecord(record);
  if (!normalized) {
    return null;
  }

  const parsed = v.safeParse(RowValueSchema, normalized.value);
  if (!parsed.success) {
    return null;
  }

  return {
    value: normalized.value as RowType["value"],
  };
};
