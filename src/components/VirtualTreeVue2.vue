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
                ban_checkbox:
                  options && options.banCheckbox && options.banCheckbox.includes(item[pathKey]),
                ban_select:
                  options && options.banSelect && options.banSelect.includes(item[pathKey]),
              },
            ]"
            @click="clickCheckBox(item, $event)"
          />
          <em v-if="!item.unfolder" class="check_folder_icon" />
          <span class="check_item_name">{{
            item[options && options.label ? options.label : 'name']
          }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { throttle } from 'lodash-es';
import { Trie } from '@/utils/folderTreeTrie';

export default {
  name: 'VirtualTree',
  props: {
    showCustomTree: { type: Boolean, default: false },
    defaultData: { type: Array, default: () => [] },
    loadChild: Function,
    addChild: { type: Object, default: () => ({}) },
    options: { type: Object, default: () => ({}) },
    checkboxMode: { type: Boolean, default: false },
    includesPaths: { type: Array, default: () => [] },
    excludesPaths: { type: Array, default: () => [] },
  },
  data() {
    return {
      containerRef: null,
      virtualScroll: {
        startIndex: 0,
        endIndex: 0,
        viewportHeight: 0,
        itemHeight: 40,
        startOffset: 0,
      },
      flatData: [],
      maxSelfIdMap: {},
      singleUserPaths: [],
      includePathSet: new Set(),
      excludePathSet: new Set(),
      includePathTrie: new Trie(),
      clickTimer: null,
      clickCount: 0,
    };
  },
  computed: {
    pathKey() {
      return this.options && this.options.key ? this.options.key : 'path';
    },
    getTransform() {
      return `translate3d(0,${this.virtualScroll.startOffset}px,0)`;
    },
    visibleItems() {
      return this.flatData
        .filter((item) => item.isShow)
        .slice(
          this.virtualScroll.startIndex,
          Math.min(this.virtualScroll.endIndex, this.flatData.length),
        );
    },
    contentHeight() {
      return this.flatData.filter((item) => item.isShow).length * this.virtualScroll.itemHeight;
    },
    visibleItemCount() {
      return Math.ceil(this.virtualScroll.viewportHeight / this.virtualScroll.itemHeight);
    },
  },
  watch: {
    defaultData: {
      handler(newData) {
        if (newData && newData.length) {
          this.flattenTree(newData).then((result) => {
            this.flatData = result;
            this.getSingleUser();
            this.$nextTick(() => {
              this.initContainer();
            });
          });
        }
      },
      immediate: true,
      deep: true,
    },
    showCustomTree(newVal) {
      if (newVal && this.virtualScroll.endIndex === 0 && this.virtualScroll.viewportHeight === 0) {
        this.$nextTick(() => {
          this.initContainer();
        });
      }
    },
    includesPaths: {
      handler(newData) {
        if (newData && newData.length) {
          newData.forEach((item) => {
            this.includePathSet.add(item);
            this.includePathTrie.insert(item);
          });
        } else {
          this.includePathSet.clear();
          this.includePathTrie.clear();
        }
      },
      immediate: true,
    },
    excludesPaths: {
      handler(newData) {
        if (newData && newData.length) {
          newData.forEach((item) => {
            this.excludePathSet.add(item);
          });
        } else {
          this.excludePathSet.clear();
        }
      },
      immediate: true,
    },
    addChild: {
      handler(newData, oldData) {
        if (newData.id && (!oldData || newData.id !== oldData.id)) {
          if (this.loadChild) this.getChildFun(newData.node, newData.newFolder);
        }
      },
      immediate: true,
    },
  },
  methods: {
    initContainer() {
      if (this.$refs.containerRef) {
        this.virtualScroll.viewportHeight = this.$refs.containerRef.clientHeight;
        this.virtualScroll.startIndex = 0;
        this.virtualScroll.endIndex = this.virtualScroll.startIndex + this.visibleItemCount;
        this.virtualScroll.startOffset = 0;
      }
    },
    handleScroll: throttle(function (e) {
      const target = e.target;
      const scrollTop = target.scrollTop;
      this.virtualScroll.startIndex = Math.floor(scrollTop / this.virtualScroll.itemHeight);
      this.virtualScroll.endIndex = this.virtualScroll.startIndex + this.visibleItemCount;
      this.virtualScroll.startOffset =
        this.virtualScroll.startIndex * this.virtualScroll.itemHeight;
    }, 16),
    getNextSelfId(level) {
      const currentMaxId = this.maxSelfIdMap[level] || level * 1000000;
      const nextId = currentMaxId + 1;
      this.maxSelfIdMap[level] = nextId;
      return nextId;
    },
    getSingleUser() {
      const homePath = '/home';
      const hasHome = this.flatData.find((item) => item[this.pathKey] === homePath);
      if (hasHome) {
        const homeLevel = hasHome.level;
        this.singleUserPaths = this.flatData
          .filter(
            (item) =>
              item.level === homeLevel &&
              item[this.pathKey] &&
              item[this.pathKey].startsWith(homePath) &&
              item[this.pathKey] !== homePath,
          )
          .map((item) => item[this.pathKey]);
      }
    },
    createTreeNode(node, level, parent) {
      const selfId = this.getNextSelfId(level);
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
        checked: this.setCheckedStatus(node, parent),
      };
    },
    async flattenTree(originData) {
      const result = [];
      const stack = [];
      originData.forEach((node) => stack.push({ node, level: 1 }));
      let count = 0;

      while (stack.length > 0) {
        const { node, level, parent } = stack.pop();
        const formatNode = this.createTreeNode(node, level, parent);
        result.push(formatNode);

        if (node.open && node.children && node.children.length) {
          for (let i = node.children.length - 1; i >= 0; i--) {
            stack.push({ node: node.children[i], level: level + 1, parent: formatNode });
          }
        }

        count++;
        if (count % 1000 === 0) {
          await this.yieldToMain();
        }
      }
      return result;
    },
    getChildFun(currentNode, newFolder) {
      currentNode.loading = true;
      this.loadChild(currentNode, (data) => {
        currentNode.open = true;
        const childList = [];
        data.forEach((item) => {
          const selfId = this.getNextSelfId(currentNode.level + 1);
          const obj = {
            ...item,
            open: item.open || false,
            loading: false,
            parent: currentNode,
            children: item.children || [],
            level: currentNode.level + 1,
            isShow: true,
            selfId,
            checked: this.setCheckedStatus(item, currentNode),
          };
          childList.push(obj);
        });
        currentNode.children = childList;
        if (childList.length) {
          const currentIndex = this.flatData.findIndex(
            (item) => item.selfId === currentNode.selfId,
          );
          if (currentIndex !== -1) {
            this.flatData.splice(currentIndex + 1, 0, ...childList);
            if (newFolder) this.locateNewFolder(newFolder);
          }
        }
        currentNode.loading = false;
        currentNode.isLook = true;
      });
    },
    clickExpand(expandNode) {
      const childNodes = expandNode.children;
      if (childNodes && childNodes.length) {
        expandNode.open = !expandNode.open;
        const updateIsShow = (handleNode) => {
          if (!handleNode.open) {
            for (const item of this.flatData) {
              if (
                handleNode[this.pathKey] === '/home' &&
                handleNode[this.pathKey] !== item[this.pathKey] &&
                this.singleUserPaths.length
              ) {
                const allNotMatch = this.singleUserPaths.every(
                  (newPath) => !item[this.pathKey].startsWith(newPath),
                );
                if (item[this.pathKey].startsWith(`${handleNode[this.pathKey]}/`) && allNotMatch) {
                  item.isShow = false;
                }
              } else if (handleNode[this.pathKey] === '$home$' && item[this.pathKey] !== '$home$') {
                item.isShow = false;
              } else if (
                handleNode[this.pathKey] === '$share$' &&
                item[this.pathKey] !== '$share$' &&
                item[this.pathKey].startsWith('/volume')
              ) {
                item.isShow = false;
              } else if (
                item[this.pathKey].startsWith(`${handleNode[this.pathKey]}/`) &&
                handleNode[this.pathKey] !== item[this.pathKey] &&
                handleNode.level < item.level
              ) {
                item.isShow = false;
              }
            }
          } else {
            for (const item of this.flatData) {
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
      } else if (this.loadChild) {
        this.getChildFun(expandNode);
      }
    },
    getNeedData() {
      const newInclude = [];
      const newExclude = [];
      const pathMap = new Map();
      this.flatData.forEach((item) => {
        pathMap.set(item.selfId, item);
      });
      this.flatData.forEach((item) => {
        const nodePath = item[this.pathKey];
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
          if (this.includePathSet.has(nodePath) && !newInclude.includes(nodePath)) {
            newInclude.push(nodePath);
          }
        }
      });
      return { newInclude, newExclude };
    },
    updateChildState(childList, fChecked) {
      childList.forEach((item) => {
        item.checked = fChecked;
      });
    },
    updateParentState(parent) {
      const pathMap = new Map();
      this.flatData.forEach((item) => pathMap.set(item.selfId, item));
      while (parent) {
        const currentParent = pathMap.get(parent.selfId);
        if (!currentParent) break;
        const children = this.flatData.filter(
          (item) => item.parent && item.parent.selfId === currentParent.selfId,
        );
        const checkedCount = children.filter((c) => c.checked === 1).length;
        const uncheckedCount = children.filter((c) => c.checked === 0).length;
        if (checkedCount === children.length) {
          currentParent.checked = 1;
        } else if (uncheckedCount === children.length) {
          currentParent.checked = 0;
        } else {
          currentParent.checked = 2;
        }
        parent = currentParent.parent;
      }
    },
    clickCheckBox(boxNode, event) {
      const itemChecked = boxNode.checked;
      const hasChild = this.flatData.filter(
        (item) =>
          item.selfId !== boxNode.selfId &&
          item.level > boxNode.level &&
          item[this.pathKey].startsWith(`${boxNode[this.pathKey]}/`),
      );
      const hasParent = this.flatData.filter(
        (item) =>
          item.selfId !== boxNode.selfId &&
          item.level < boxNode.level &&
          item.selfId === (boxNode.parent && boxNode.parent.selfId),
      );
      switch (itemChecked) {
        case 0:
          boxNode.checked = 1;
          if (hasChild.length) this.updateChildState(hasChild, 1);
          if (hasParent.length && boxNode.parent) this.updateParentState(boxNode.parent);
          break;
        case 1:
          boxNode.checked = 0;
          if (hasChild.length) this.updateChildState(hasChild, 0);
          if (hasParent.length && boxNode.parent) this.updateParentState(boxNode.parent);
          break;
        case 2:
          boxNode.checked = 0;
          if (hasChild.length) this.updateChildState(hasChild, 0);
          if (hasParent.length && boxNode.parent) this.updateParentState(boxNode.parent);
          break;
        default:
          break;
      }
      const { newInclude, newExclude } = this.getNeedData();
      this.$emit('onCheckChange', {
        include: newInclude,
        exclude: newExclude,
        origin: this.flatData,
        source: boxNode,
        event,
      });
    },
    handleMouseDown(boxNode) {
      this.clickCount += 1;
      if (this.clickCount === 1) {
        this.clickTimer = setTimeout(() => {
          this.handleSingleClick(boxNode);
          this.clickCount = 0;
        }, 200);
      } else if (this.clickCount === 2) {
        clearTimeout(this.clickTimer);
        this.handleDoubleClick(boxNode);
        this.clickCount = 0;
      }
    },
    handleMouseUp(boxNode) {
      // 可自定义
    },
    handleSingleClick(boxNode) {
      if (!this.checkboxMode) {
        boxNode.checked = 1;
        this.flatData.forEach((item) => {
          if (item.selfId !== boxNode.selfId && item.checked !== 0) item.checked = 0;
        });
        const nodes = [];
        nodes.push(boxNode);
        this.$emit('onSelectChange', {
          nodes,
          data: boxNode,
        });
      }
    },
    handleDoubleClick(boxNode) {
      this.clickExpand(boxNode);
    },
    setNodeClass(boxNode) {
      let className = '';
      if (!this.checkboxMode && boxNode.checked === 1) {
        className = 'row_be_selected';
      }
      return className;
    },
    locateNewFolder(folder) {
      const labelKey = this.options && this.options.label ? this.options.label : 'name';
      const showIdx = this.visibleItems.findIndex((item) => item[labelKey] === folder);
      const index = this.flatData.findIndex((item) => item[labelKey] === folder);
      // 可自定义定位逻辑
    },
    setCheckedStatus(item, parentNode) {
      if ([0, 1, 2].includes(item.checked)) return item.checked;
      const path = item[this.pathKey];
      const matchResult = this.includePathTrie.checkPrefixAndExactMatch(`${path}/`, path);
      if (!path || (this.includePathSet.size === 0 && this.excludePathSet.size === 0)) return 0;
      if (this.includePathSet.has(path)) return 1;
      if (parentNode && parentNode.checked === 1) {
        return this.excludePathSet.has(path) ? 0 : 1;
      }
      return matchResult.startsWith ? 2 : 0;
    },
    yieldToMain() {
      return new Promise((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    },
  },
  mounted() {
    this.initContainer();
  },
};
</script>
