declare module 'antd';
declare module 'antd/es/tree' {
  import * as React from 'react';
  import type { TreeProps } from 'antd';
  export interface DataNode {
    title: React.ReactNode;
    key: React.Key;
    children?: DataNode[];
    isLeaf?: boolean;
  }
  export interface EventDataNode extends DataNode {
    expanded?: boolean;
    selected?: boolean;
  }
  const Tree: React.FC<TreeProps>;
  export default Tree;
  export type { DataNode, EventDataNode };
}


