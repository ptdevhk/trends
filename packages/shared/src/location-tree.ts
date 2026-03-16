type LocationLevel = "province" | "city" | "district";

type LocationSeed = {
  name: string;
  aliases?: string[];
  children?: LocationSeed[];
};

type InternalLocationNode = {
  id: string;
  name: string;
  aliases: string[];
  level: LocationLevel;
  depth: number;
  parentId?: string;
  childIds: string[];
};

type AliasEntry = {
  alias: string;
  nodeId: string;
  depth: number;
};

export type LocationNode = {
  name: string;
  aliases: string[];
  level: LocationLevel;
  parentName?: string;
  children: string[];
};

const LOCATION_SUFFIXES = [
  "特别行政区",
  "自治州",
  "自治县",
  "自治区",
  "市辖区",
  "新区",
  "地区",
  "街道",
  "省",
  "市",
  "区",
  "县",
  "镇",
  "乡",
] as const;

const LOCATION_TREE: LocationSeed[] = [
  {
    name: "广东",
    aliases: ["广东省"],
    children: [
      { name: "广州", aliases: ["广州市"] },
      { name: "深圳", aliases: ["深圳市"] },
      { name: "珠海", aliases: ["珠海市"] },
      { name: "汕头", aliases: ["汕头市"] },
      { name: "佛山", aliases: ["佛山市"] },
      { name: "韶关", aliases: ["韶关市"] },
      { name: "湛江", aliases: ["湛江市"] },
      { name: "肇庆", aliases: ["肇庆市"] },
      { name: "江门", aliases: ["江门市"] },
      { name: "茂名", aliases: ["茂名市"] },
      { name: "惠州", aliases: ["惠州市"] },
      { name: "梅州", aliases: ["梅州市"] },
      { name: "汕尾", aliases: ["汕尾市"] },
      { name: "河源", aliases: ["河源市"] },
      { name: "阳江", aliases: ["阳江市"] },
      { name: "清远", aliases: ["清远市"] },
      {
        name: "东莞",
        aliases: ["东莞市"],
        children: [
          { name: "南城", aliases: ["南城区"] },
          { name: "东城", aliases: ["东城区"] },
          { name: "万江", aliases: ["万江区"] },
          { name: "莞城", aliases: ["莞城区"] },
          { name: "长安", aliases: ["长安镇"] },
          { name: "虎门", aliases: ["虎门镇"] },
          { name: "厚街", aliases: ["厚街镇"] },
          { name: "常平", aliases: ["常平镇"] },
          { name: "塘厦", aliases: ["塘厦镇"] },
          { name: "凤岗", aliases: ["凤岗镇"] },
          { name: "松山湖", aliases: ["松山湖高新区", "松山湖园区"] },
        ],
      },
      { name: "中山", aliases: ["中山市"] },
      { name: "潮州", aliases: ["潮州市"] },
      { name: "揭阳", aliases: ["揭阳市"] },
      { name: "云浮", aliases: ["云浮市"] },
    ],
  },
  {
    name: "江苏",
    aliases: ["江苏省"],
    children: [
      { name: "南京", aliases: ["南京市"] },
      { name: "无锡", aliases: ["无锡市"] },
      { name: "常州", aliases: ["常州市"] },
      {
        name: "苏州",
        aliases: ["苏州市"],
        children: [{ name: "昆山", aliases: ["昆山市"] }],
      },
      { name: "南通", aliases: ["南通市"] },
      { name: "镇江", aliases: ["镇江市"] },
      { name: "扬州", aliases: ["扬州市"] },
    ],
  },
  {
    name: "浙江",
    aliases: ["浙江省"],
    children: [
      { name: "杭州", aliases: ["杭州市"] },
      { name: "宁波", aliases: ["宁波市"] },
      { name: "温州", aliases: ["温州市"] },
      { name: "嘉兴", aliases: ["嘉兴市"] },
      { name: "湖州", aliases: ["湖州市"] },
      { name: "绍兴", aliases: ["绍兴市"] },
      { name: "金华", aliases: ["金华市"] },
      { name: "台州", aliases: ["台州市"] },
    ],
  },
  {
    name: "上海",
    aliases: ["上海市"],
    children: [
      { name: "浦东", aliases: ["浦东新区"] },
      { name: "闵行", aliases: ["闵行区"] },
      { name: "松江", aliases: ["松江区"] },
      { name: "嘉定", aliases: ["嘉定区"] },
      { name: "宝山", aliases: ["宝山区"] },
      { name: "青浦", aliases: ["青浦区"] },
      { name: "徐汇", aliases: ["徐汇区"] },
      { name: "静安", aliases: ["静安区"] },
    ],
  },
  {
    name: "Malaysia",
    aliases: ["MY", "马来西亚"],
    children: [
      {
        name: "Kuala Lumpur",
        aliases: ["Kuala Lumpur MY", "Kuala Lumpur, Malaysia", "KualaLumpur", "吉隆坡"],
      },
    ],
  },
];

const nodesById = new Map<string, InternalLocationNode>();
const aliasesToNodeIds = new Map<string, string[]>();
const aliasEntries: AliasEntry[] = [];

function toLocationLevel(depth: number): LocationLevel {
  if (depth <= 1) return "province";
  if (depth === 2) return "city";
  return "district";
}

function addAlias(alias: string, nodeId: string, depth: number): void {
  const existingNodeIds = aliasesToNodeIds.get(alias) ?? [];
  if (!existingNodeIds.includes(nodeId)) {
    aliasesToNodeIds.set(alias, [...existingNodeIds, nodeId]);
  }

  if (!aliasEntries.some((entry) => entry.alias === alias && entry.nodeId === nodeId)) {
    aliasEntries.push({ alias, nodeId, depth });
  }
}

function normalizeAliasList(name: string, aliases?: string[]): string[] {
  const values = [name, ...(aliases ?? [])]
    .map((value) => normalizeLocationName(value))
    .filter((value) => value.length > 0);
  return Array.from(new Set(values));
}

function buildLocationIndex(
  seeds: LocationSeed[],
  parentId: string | undefined,
  parentPath: string[],
  depth: number
): void {
  for (const seed of seeds) {
    const normalizedName = normalizeLocationName(seed.name);
    if (!normalizedName) {
      continue;
    }

    const pathParts = [...parentPath, normalizedName];
    const nodeId = pathParts.join(">");
    const aliases = normalizeAliasList(seed.name, seed.aliases);

    const node: InternalLocationNode = {
      id: nodeId,
      name: normalizedName,
      aliases,
      level: toLocationLevel(depth),
      depth,
      parentId,
      childIds: [],
    };
    nodesById.set(nodeId, node);

    aliases.forEach((alias) => addAlias(alias, nodeId, depth));

    if (parentId) {
      const parentNode = nodesById.get(parentId);
      if (parentNode) {
        parentNode.childIds.push(nodeId);
      }
    }

    if (seed.children && seed.children.length > 0) {
      buildLocationIndex(seed.children, nodeId, pathParts, depth + 1);
    }
  }
}

buildLocationIndex(LOCATION_TREE, undefined, [], 1);

const sortedAliasEntries = [...aliasEntries].sort((left, right) => {
  if (right.alias.length !== left.alias.length) {
    return right.alias.length - left.alias.length;
  }
  return right.depth - left.depth;
});

function getNodeById(nodeId: string): InternalLocationNode | undefined {
  return nodesById.get(nodeId);
}

function nodeToPublic(node: InternalLocationNode): LocationNode {
  const parentNode = node.parentId ? getNodeById(node.parentId) : undefined;
  return {
    name: node.name,
    aliases: [...node.aliases],
    level: node.level,
    parentName: parentNode?.name,
    children: node.childIds
      .map((childId) => getNodeById(childId)?.name)
      .filter((value): value is string => Boolean(value)),
  };
}

function pickBestNode(nodeIds: string[], normalizedInput: string): InternalLocationNode | undefined {
  let bestNode: InternalLocationNode | undefined;
  let bestScore = -1;

  for (const nodeId of nodeIds) {
    const node = getNodeById(nodeId);
    if (!node) {
      continue;
    }

    const bestAliasScore = node.aliases.reduce((maxScore, alias) => {
      if (normalizedInput === alias) {
        return Math.max(maxScore, 1000 + alias.length);
      }
      if (normalizedInput.includes(alias)) {
        return Math.max(maxScore, alias.length);
      }
      return maxScore;
    }, 0);

    const score = (bestAliasScore * 10) + node.depth;
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }

  return bestNode;
}

function findLocationNode(name: string): InternalLocationNode | undefined {
  const normalizedInput = normalizeLocationName(name);
  if (!normalizedInput) {
    return undefined;
  }

  const directMatches = aliasesToNodeIds.get(normalizedInput);
  if (directMatches && directMatches.length > 0) {
    return pickBestNode(directMatches, normalizedInput);
  }

  const candidateNodeIds: string[] = [];
  const seenNodeIds = new Set<string>();
  for (const entry of sortedAliasEntries) {
    if (!normalizedInput.includes(entry.alias)) {
      continue;
    }
    if (seenNodeIds.has(entry.nodeId)) {
      continue;
    }
    seenNodeIds.add(entry.nodeId);
    candidateNodeIds.push(entry.nodeId);
  }

  return pickBestNode(candidateNodeIds, normalizedInput);
}

function extractLocationNodeIds(value: string): string[] {
  const normalizedInput = normalizeLocationName(value);
  if (!normalizedInput) {
    return [];
  }

  const matchedNodeIds = new Set<string>();
  const exactMatches = aliasesToNodeIds.get(normalizedInput);
  if (exactMatches) {
    exactMatches.forEach((nodeId) => matchedNodeIds.add(nodeId));
  }

  for (const entry of sortedAliasEntries) {
    if (normalizedInput.includes(entry.alias)) {
      matchedNodeIds.add(entry.nodeId);
    }
  }

  return Array.from(matchedNodeIds);
}

function isSameOrDescendant(nodeId: string, ancestorId: string): boolean {
  let currentNode = getNodeById(nodeId);
  while (currentNode) {
    if (currentNode.id === ancestorId) {
      return true;
    }
    currentNode = currentNode.parentId ? getNodeById(currentNode.parentId) : undefined;
  }
  return false;
}

export function normalizeLocationName(name: string): string {
  if (!name) {
    return "";
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }

  if (/[A-Za-z]/.test(trimmed)) {
    return trimmed
      .replace(/[，,、]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  let normalized = trimmed
    .replace(/[，,、]/g, "")
    .replace(/\s+/g, "");

  if (normalized.startsWith("中国")) {
    normalized = normalized.slice(2);
  }

  if (!normalized) {
    return "";
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LOCATION_SUFFIXES) {
      if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
        normalized = normalized.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }

  return normalized;
}

export function findLocation(name: string): LocationNode | undefined {
  const node = findLocationNode(name);
  return node ? nodeToPublic(node) : undefined;
}

export function getChildren(parentName: string): LocationNode[] {
  const parent = findLocationNode(parentName);
  if (!parent) {
    return [];
  }

  return parent.childIds
    .map((childId) => getNodeById(childId))
    .filter((child): child is InternalLocationNode => Boolean(child))
    .map((child) => nodeToPublic(child));
}

export function getAllDescendants(ancestorName: string): LocationNode[] {
  const ancestor = findLocationNode(ancestorName);
  if (!ancestor) {
    return [];
  }

  const queue = [...ancestor.childIds];
  const descendants: LocationNode[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) {
      continue;
    }
    const currentNode = getNodeById(currentId);
    if (!currentNode) {
      continue;
    }
    descendants.push(nodeToPublic(currentNode));
    queue.push(...currentNode.childIds);
  }

  return descendants;
}

export function isLocationMatch(resumeLocation: string, filterName: string): boolean {
  const normalizedFilter = normalizeLocationName(filterName);
  if (!normalizedFilter) {
    return true;
  }

  const normalizedResume = normalizeLocationName(resumeLocation);
  if (!normalizedResume) {
    return false;
  }

  if (normalizedResume === normalizedFilter || normalizedResume.includes(normalizedFilter)) {
    return true;
  }

  const filterNode = findLocationNode(filterName);
  if (!filterNode) {
    return normalizedResume.includes(normalizedFilter);
  }

  const resumeNodeIds = extractLocationNodeIds(resumeLocation);
  if (resumeNodeIds.length === 0) {
    return filterNode.aliases.some((alias) => normalizedResume.includes(alias));
  }

  return resumeNodeIds.some((nodeId) => isSameOrDescendant(nodeId, filterNode.id));
}
