// @/utils/folderTreeTrie.ts
class TrieNode {
  children: Map<string, TrieNode>;
  isEnd: boolean; // 标记是否是完整路径的终点

  constructor() {
    this.children = new Map();
    this.isEnd = false;
  }
}

export class Trie {
  private root: TrieNode;

  constructor() {
    this.root = new TrieNode();
  }

  /**
   * 插入一个路径到前缀树
   * @param path 要插入的路径
   */
  insert(path: string): void {
    let node = this.root;
    // 分割路径为各个部分（支持Unix和Windows路径）
    const segments = this.splitPath(path);

    for (const segment of segments) {
      if (!node.children.has(segment)) {
        node.children.set(segment, new TrieNode());
      }
      node = node.children.get(segment)!;
    }
    node.isEnd = true; // 标记路径终点
  }

  /**
   * 检查路径是否存在（精确匹配）
   * @param path 要检查的路径
   * @returns 是否存在精确匹配
   */
  contains(path: string): boolean {
    let node = this.root;
    const segments = this.splitPath(path);

    for (const segment of segments) {
      if (!node.children.has(segment)) {
        return false;
      }
      node = node.children.get(segment)!;
    }
    return node.isEnd;
  }

  /**
   * 检查路径是否包含任何前缀（前缀匹配）
   * @param path 要检查的路径
   * @returns 是否包含前缀匹配
   */
  hasPrefix(path: string): boolean {
    let node = this.root;
    const segments = this.splitPath(path);

    for (const segment of segments) {
      if (!node.children.has(segment)) {
        return false;
      }
      node = node.children.get(segment)!;
    }
    return true;
  }

  /**
   * 检查路径是否包含前缀或精确匹配
   * @param prefix 要检查的前缀
   * @param exact 要检查的精确路径
   * @returns 包含前缀和精确匹配的对象
   */
  checkPrefixAndExactMatch(
    prefix: string,
    exact: string,
  ): {
    startsWith: boolean;
    exactMatch: boolean;
  } {
    return {
      startsWith: this.hasPrefix(prefix),
      exactMatch: this.contains(exact),
    };
  }

  /**
   * 清空前缀树
   */
  clear(): void {
    this.root = new TrieNode();
  }

  /**
   * 分割路径为标准化片段
   * @param path 原始路径
   * @returns 标准化后的路径片段数组
   */
  private splitPath(path: string): string[] {
    // 处理特殊路径标识（如$home$）
    if (path.startsWith('$') && path.endsWith('$')) {
      return [path];
    }

    // 标准化路径：统一分隔符并移除首尾多余分隔符
    const normalized = path
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/|\/$/g, '');

    // 空路径处理
    if (normalized === '') return [];

    return normalized.split('/');
  }
}
