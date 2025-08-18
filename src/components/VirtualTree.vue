<template>
  <div ref="containerRef" @scroll="handleScroll" class="container">
    <div :style="{ height: contentHeight + 'px', position: 'relative' }">
      <div
        v-for="item in visibleItems"
        :key="item[pathKey] + item.selfId"
        :style="{ transform: getTransform, height: virtualScroll.itemHeight + 'px' }"
        class="basic_visible_item"
        :class="setNodeClass(item)"
        @mousedown="handleMouseDown(item)"
        @mouseup="handleMouseUp(item)"
      >
        <div class="check_container_item" :style="{ paddingLeft: `${item.level * 20 - 20}px` }">
          <span class="check_item_icon">
            <i
              v-show="(!item.loading && !item.isLook) || (item.isLook && item.children.length)"
              class="check_item_expand"
              :class="{ is_open: item.open }"
              @mousedown.stop
              @mouseup.stop
              @click.stop="clickExpand(item)"
            />
            <i v-show="item.loading" class="check_item_loading" />
          </span>
          <span
            v-if="checkboxMode"
            class="check_item_box"
            :class="[
              `checked_${item.checked}`,
              {
                ban_checkbox: options?.banCheckbox?.includes(item[pathKey]),
                ban_select: options?.banSelect?.includes(item[pathKey]),
              },
            ]"
            @click="clickCheckBox(item, $event)"
          />
          <em v-if="!item.unfolder" class="check_folder_icon" />
          <span class="check_item_name">{{ item[options.label] }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, reactive, toRefs, computed, watch, nextTick } from 'vue';
import { throttle } from 'lodash-es'; // 使用 lodash 的 throttle
import { Trie } from '@/utils/folderTreeTrie';

// 节点参数接口
interface TreeNode {
  path?: string;
  name?: string;
  open?: boolean;
  checked?: number;
  isLook?: boolean;
  loading?: boolean;
  unfolder?: boolean;
  parent?: TreeNode;
  children?: TreeNode[];
  level?: number;
  isShow?: boolean;
  selfId?: number;
}

// 传入树配置接口
interface TreeOptions {
  label?: string; // 路径名
  key?: string; // 路径键
  banCheckbox?: string[]; // 禁显示的checkbox框
  banSelect?: string[]; // 禁选操作的checkbox框
}

interface NodeAddParam {
  id?: number;
  node?: TreeNode; // 新增子目录的父节点
  newFolder?: string; // 新建目录名称
}

// 定义Props类型
type TreeProps = {
  showCustomTree?: boolean;
  defaultData?: TreeNode[];
  loadChild?: (node: TreeNode, callback: (data: TreeNode[]) => void) => void;
  addChild?: NodeAddParam;
  options?: TreeOptions;
  checkboxMode?: boolean;
  includesPaths?: string[];
  excludesPaths?: string[];
};

const props = withDefaults(defineProps<TreeProps>(), {
  showCustomTree: false,
  defaultData: () => [],
  addChild: () => ({}),
  options: () => ({}),
  checkboxMode: false,
  includesPaths: () => [],
  excludesPaths: () => [],
});

type EmitEvents = {
  (
    e: 'onCheckChange',
    payload: {
      include: string[];
      exclude: string[];
      origin: TreeNode[];
      source: object;
      event: object;
    },
  ): void;

  (
    e: 'onSelectChange',
    payload: {
      nodes?: TreeNode[];
      data?: TreeNode;
    },
  ): void;
};

const emit = defineEmits<EmitEvents>();

// 树配置
const { options } = toRefs(props);
const { checkboxMode } = props;

// 容器
const containerRef = ref<HTMLElement | null>(null);
// 可视区信息
const virtualScroll = reactive({
  startIndex: 0, // 其实下标
  endIndex: 0, // 结束下标
  viewportHeight: 0, // 可视窗口高度
  itemHeight: 40, // 滚动项高度
  startOffset: ref(0), // 滚动偏移量
});
// 打平列表数据
const flatData = ref<TreeNode[]>([]);
// 记录每层的最大 selfId
const maxSelfIdMap = new Map<number, number>();
// 用户文件夹排除用户目录
let singleUserPaths: string[] = [];
// 已选路径哈希
const includePathSet = new Set();
// 排除路径哈希
const excludePathSet = new Set();
// 已选路径前缀树
const includePathTrie = new Trie();

// 点击行数据时间间隔
const clickTimer = ref(null);
// 点击行次数
const clickCount = ref(0);

// 路径key
const pathKey = computed(() => options?.value.key || 'path');

// 设置滚动偏移
const getTransform = computed(() => `translate3d(0,${virtualScroll.startOffset}px,0)`);

// 可视区内容
const visibleItems = computed(() => {
  return flatData.value
    .filter((item) => item.isShow)
    .slice(virtualScroll.startIndex, Math.min(virtualScroll.endIndex, flatData.value.length));
});

// 内容区虚拟区域需要被撑开的高度
const contentHeight = computed(
  () => flatData.value.filter((item) => item.isShow).length * virtualScroll.itemHeight,
);

// 可视区子项个数
const visibleItemCount = computed(() => {
  return Math.ceil(virtualScroll.viewportHeight / virtualScroll.itemHeight);
});

/**
 * 初始化容器
 */
const initContainer = () => {
  if (containerRef.value) {
    virtualScroll.viewportHeight = containerRef.value.clientHeight;
    virtualScroll.startIndex = 0;
    virtualScroll.endIndex = virtualScroll.startIndex + visibleItemCount.value;
    virtualScroll.startOffset = 0;
  }
};

/**
 * 监听可视区滚动事件（使用 throttle 优化）
 */
const handleScroll = throttle((e: Event) => {
  const target = e.target as HTMLElement;
  const scrollTop = target.scrollTop;
  virtualScroll.startIndex = Math.floor(scrollTop / virtualScroll.itemHeight);
  virtualScroll.endIndex = virtualScroll.startIndex + visibleItemCount.value;
  virtualScroll.startOffset = virtualScroll.startIndex * virtualScroll.itemHeight;
  console.log(target, scrollTop, virtualScroll);
}, 16); // 16ms 一次，约 60fps

/**
 * 记录&获取每层最大的selfId
 * @param level 层级
 */
const getNextSelfId = (level: number): number => {
  const currentMaxId = maxSelfIdMap.get(level) || level * 1000000;
  const nextId = currentMaxId + 1;
  maxSelfIdMap.set(level, nextId);
  return nextId;
};

/**
 * 获得用户文件夹同级的个人文件夹
 */
const getSingleUser = () => {
  const homePath = '/home';
  const hasHome = flatData.value.find((item) => item[pathKey.value] === homePath);
  if (hasHome) {
    const homeLevel = hasHome.level;
    singleUserPaths = flatData.value
      .filter(
        (item) =>
          item.level === homeLevel &&
          item[pathKey.value].startsWith(homePath) &&
          item[pathKey.value] !== homePath,
      )
      .map((item) => item[pathKey.value]);
  }
};

/**
 * 生成扁平节点
 * @param node 节点
 * @param level 层级
 * @param parent 父级
 */
const createTreeNode = (node: TreeNode, level: number, parent?: TreeNode) => {
  // 为当前节点添加 level 和 isShow 和 selfId 属性，并返回
  const selfId = getNextSelfId(level);
  return {
    ...node,
    open: node.open || false,
    loading: false,
    isLook: false,
    parent: parent,
    children: node.children || [],
    level,
    isShow: true,
    selfId,
    checked: setCheckedStatus(node, parent),
  };
};

/**
 * 扁平格式化数据
 * @param originData 原树状数据
 * @param level 层级
 * @param parent 父级数据
 */
const flattenTree = async (originData: TreeNode[]): Promise<TreeNode[]> => {
  const result: TreeNode[] = [];
  const stack: { node: TreeNode; level: number; parent?: TreeNode }[] = [];
  originData.forEach((node) => stack.push({ node, level: 1 }));
  let count = 0;

  while (stack.length > 0) {
    const { node, level, parent } = stack.pop()!;
    const formatNode = createTreeNode(node, level, parent);
    result.push(formatNode);

    if (node.open && node.children?.length) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        stack.push({ node: node.children[i], level: level + 1, parent: formatNode });
      }
    }

    count++;
    if (count % 1000 === 0) {
      await yieldToMain(); // 让出主线程
    }
  }

  return result;
};

/**
 * 加载子节点
 * @param currentNode 当前节点
 */
const getChildFun = (currentNode: TreeNode, newFolder?: string) => {
  currentNode.loading = true;
  props.loadChild(currentNode, (data: TreeNode[]) => {
    console.log('child', data);
    currentNode.open = true;
    const childList = [];
    data.forEach((item) => {
      const selfId = getNextSelfId(currentNode.level + 1);
      const obj = {
        ...item,
        open: item.open || false,
        loading: false,
        parent: currentNode,
        children: item.children || [],
        level: currentNode.level + 1,
        isShow: true,
        selfId,
        checked: setCheckedStatus(item, currentNode),
      };
      childList.push(obj);
    });
    currentNode.children = childList;
    if (childList.length) {
      const currentIndex = flatData.value.findIndex((item) => item.selfId === currentNode.selfId);
      if (currentIndex !== -1) {
        flatData.value.splice(currentIndex + 1, 0, ...childList);
        if (newFolder) locateNewFolder(newFolder);
      }
    }
    currentNode.loading = false;
    currentNode.isLook = true;
  });
};

/**
 * 点击展开/收起节点
 * @param expandNode 当前节点
 */
const clickExpand = (expandNode: TreeNode) => {
  const childNodes = expandNode.children;

  if (childNodes && childNodes.length) {
    expandNode.open = !expandNode.open;
    const updateIsShow = (handleNode: TreeNode) => {
      // 如果 open 为 false
      if (!handleNode.open) {
        for (const item of flatData.value) {
          // 如果当前对象的 path 以 node.path 开头
          if (
            handleNode[pathKey.value] === '/home' &&
            handleNode[pathKey.value] !== item[pathKey.value] &&
            singleUserPaths.length
          ) {
            const allNotMatch = singleUserPaths.every(
              (newPath) => !item[pathKey.value].startsWith(newPath),
            );
            if (item[pathKey.value].startsWith(`${handleNode[pathKey.value]}/`) && allNotMatch) {
              item.isShow = false;
            }
          } else if (handleNode[pathKey.value] === '$home$' && item[pathKey.value] !== '$home$') {
            item.isShow = false;
          } else if (
            handleNode[pathKey.value] === '$share$' &&
            item[pathKey.value] !== '$share$' &&
            item[pathKey.value].startsWith('/volume')
          ) {
            item.isShow = false;
          } else if (
            item[pathKey.value].startsWith(`${handleNode[pathKey.value]}/`) &&
            handleNode[pathKey.value] !== item[pathKey.value] &&
            handleNode.level < item.level
          ) {
            item.isShow = false;
          }
        }
      } else {
        // 如果 open 为 true，按照之前的逻辑处理
        for (const item of flatData.value) {
          if (item.parent && item.parent.selfId === handleNode.selfId) {
            item.isShow = true;
            if (item.open) {
              updateIsShow(item);
            }
          }
        }
      }
    };
    updateIsShow(expandNode);
  } else if (props.loadChild) {
    getChildFun(expandNode);
  }
};

/**
 * 获取选中节点
 */
const getNeedData = () => {
  const newInclude = [];
  const newExclude = [];
  // 路径哈希表，快速找到路径对应的数据
  const pathMap = new Map();

  flatData.value.forEach((item) => {
    pathMap.set(item.selfId, item);
  });

  flatData.value.forEach((item) => {
    const nodePath = item[pathKey.value];
    const nodeChecked = item.checked;
    if (['$home$', '$share$', '/home'].includes(nodePath)) return;
    let parentChecked = undefined;
    if (item.parent) {
      const parentItem = pathMap.get(item.parent.selfId);
      if (parentItem) {
        parentChecked = parentItem.checked;
      }
    }
    if (nodeChecked === 1) {
      newInclude.push(nodePath);
    } else if ([0].includes(nodeChecked) && [1].includes(parentChecked)) {
      newExclude.push(nodePath);
    }

    if ([1].includes(nodeChecked)) {
      if (includePathSet.has(nodePath) && !newInclude.includes(nodePath)) {
        newInclude.push(nodePath);
      }
    }
  });

  return { newInclude, newExclude };
};

/**
 * 修改子节点状态
 * @param childList 子级数据
 * @param fChecked 相对子而言父checked状态
 */
const updateChildState = (childList: TreeNode[], fChecked: number) => {
  childList.forEach((item) => {
    item.checked = fChecked;
  });
};

/**
 * 修改父节点状态
 * @param parent 父级数据
 * @param sChecked 相对父而言子checked状态
 */
const updateParentState = (parent: TreeNode) => {
  // 创建 path 到对象的映射
  const pathMap = new Map();
  flatData.value.forEach((item) => pathMap.set(item.selfId, item));

  while (parent) {
    const currentParent = pathMap.get(parent.selfId);
    if (!currentParent) break;

    // 获取所有直接子节点
    const children = flatData.value.filter((item) => item.parent?.selfId === currentParent.selfId);

    // 计算子节点的选中状态
    const checkedCount = children.filter((c) => c.checked === 1).length;
    const uncheckedCount = children.filter((c) => c.checked === 0).length;

    // 根据交互规则更新父节点状态
    if (checkedCount === children.length) {
      // 所有子节点全选 → 父节点全选 (1)
      currentParent.checked = 1;
    } else if (uncheckedCount === children.length) {
      // 所有子节点未选 → 父节点未选 (0)
      currentParent.checked = 0;
    } else {
      // 部分子节点选中 → 父节点半选 (2)
      currentParent.checked = 2;
    }

    // 继续向上遍历父节点
    parent = currentParent.parent;
  }
};

/**
 * 点击节点box框
 * @param boxNode 节点数据
 */
const clickCheckBox = (boxNode: TreeNode, event) => {
  console.time();
  const itemChecked = boxNode.checked;
  const hasChild = flatData.value.filter(
    (item) =>
      item.selfId !== boxNode.selfId &&
      item.level > boxNode.level &&
      item[pathKey.value].startsWith(`${boxNode[pathKey.value]}/`),
  );
  const hasParent = flatData.value.filter(
    (item) =>
      item.selfId !== boxNode.selfId &&
      item.level < boxNode.level &&
      item.selfId === boxNode.parent.selfId,
  );

  // 根据点击获取checked值处理相应逻辑
  switch (itemChecked) {
    case 0:
      boxNode.checked = 1;
      if (hasChild.length) updateChildState(hasChild, 1);
      if (hasParent.length) updateParentState(boxNode.parent);
      break;

    case 1:
      boxNode.checked = 0;
      if (hasChild.length) updateChildState(hasChild, 0);
      if (hasParent.length) updateParentState(boxNode.parent);
      break;

    case 2:
      boxNode.checked = 0;
      if (hasChild.length) updateChildState(hasChild, 0);
      if (hasParent.length) updateParentState(boxNode.parent);
      break;
    default:
      break;
  }

  // 选中&排除 所有项
  const { newInclude, newExclude } = getNeedData();
  console.timeEnd();

  emit('onCheckChange', {
    include: newInclude,
    exclude: newExclude,
    origin: flatData.value,
    source: boxNode,
    event,
  });
};

/**
 * 鼠标按下
 * @param boxNode 节点数据
 */
const handleMouseDown = (boxNode: TreeNode) => {
  clickCount.value += 1;

  if (clickCount.value === 1) {
    clickTimer.value = setTimeout(() => {
      // 单击处理
      handleSingleClick(boxNode);
      clickCount.value = 0;
    }, 200); // 200ms是判断单击/双击的时间阈值
  } else if (clickCount.value === 2) {
    // 双击处理
    clearTimeout(clickTimer.value);
    handleDoubleClick(boxNode);
    clickCount.value = 0;
  }
};

/**
 * 鼠标弹起
 * @param boxNode 节点数据
 */
const handleMouseUp = (boxNode: TreeNode) => {
  console.log('handleMouseUp', boxNode);
};

/**
 * 单击节点
 * @param boxNode 节点数据
 */
const handleSingleClick = (boxNode: TreeNode) => {
  if (!checkboxMode) {
    boxNode.checked = 1;
    flatData.value.forEach((item) => {
      if (item.selfId !== boxNode.selfId && item.checked !== 0) item.checked = 0;
    });
    const nodes = [];
    nodes.push(boxNode);

    emit('onSelectChange', {
      nodes,
      data: boxNode,
    });
  }
};

/**
 * 双击节点
 * @param boxNode 节点数据
 */
const handleDoubleClick = (boxNode: TreeNode) => {
  clickExpand(boxNode);
};

/**
 * 设置节点类名
 * @param boxNode 节点数据
 */
const setNodeClass = (boxNode: TreeNode) => {
  let className = '';
  if (!checkboxMode && boxNode.checked === 1) {
    className = 'row_be_selected';
  }
  return className;
};

/**
 * 定位新建子目录
 * @param folder 节点名称
 */
const locateNewFolder = (folder) => {
  const showIdx = visibleItems.value.findIndex((item) => item[options.value.label] === folder);
  // if (showIdx === -1) return;
  const index = flatData.value.findIndex((item) => item[options.value.label] === folder);
  console.log(showIdx, index);
};

/**
 * 设置节点选中状态
 * @param item 节点
 */
const setCheckedStatus = (item: TreeNode, parentNode: TreeNode = undefined) => {
  if ([0, 1, 2].includes(item.checked)) return item.checked;

  const path = item[pathKey.value];

  const matchResult = includePathTrie.checkPrefixAndExactMatch(`${path}/`, path);

  // 提前检查路径和数组是否为空
  if (!path || (includePathSet.size === 0 && excludePathSet.size === 0)) return 0;

  // 检查路径是否在 includePaths 中
  if (includePathSet.has(path)) return 1;

  // 检查父节点和父节点的 checked 值
  if (parentNode?.checked === 1) {
    return excludePathSet.has(path) ? 0 : 1;
  }

  // 父节点不存在或 checked 值不为 1 的情况
  return matchResult.startsWith ? 2 : 0;
};

const yieldToMain = () => {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
};

// 监听 defaultData 的变化
watch(
  () => props.defaultData,
  (newData) => {
    if (newData && newData.length) {
      flattenTree(newData).then((result) => {
        flatData.value = result;
        getSingleUser();
        nextTick(() => {
          initContainer();
        });
      });
    }
  },
  { immediate: true, deep: true },
);

// 监听页面是否显示，编辑时需要
watch(
  () => props.showCustomTree,
  (newData) => {
    if (newData && virtualScroll.endIndex === 0 && virtualScroll.viewportHeight === 0) {
      nextTick(() => {
        initContainer();
      });
    }
  },
);

// 监听已选项，设置路径hash&trie
watch(
  () => props.includesPaths,
  (newData) => {
    if (newData && newData.length) {
      newData.forEach((item) => {
        includePathSet.add(item);
        includePathTrie.insert(item);
      });
    } else {
      includePathSet.clear();
      includePathTrie.clear();
    }
  },
  { immediate: true },
);

// 监听排除项，设置排除hash
watch(
  () => props.excludesPaths,
  (newData) => {
    if (newData && newData.length) {
      newData.forEach((item) => {
        excludePathSet.add(item);
      });
    } else {
      excludePathSet.clear();
    }
  },
  { immediate: true },
);

// 监听新增子目录事件
watch(
  () => props.addChild,
  (newData, oldData) => {
    if (newData.id && (!oldData || newData.id !== oldData.id)) {
      if (props.loadChild) getChildFun(newData.node, newData.newFolder);
    }
  },
  { immediate: true },
);
</script>
