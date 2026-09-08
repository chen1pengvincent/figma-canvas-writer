// Core reading commands: getContext / getSelection / getNodeInfo. These keep
// the original public contract. Extended semantic readers live in read-layer.js.
import { appErr, requireNum, onlyKeys, buildNodeInfo, paginate } from './util.js';
import { getNode, getContext } from './context.js';

export const handlers = {
  async getContext(p, t) {
    return paginate(figma.currentPage.children, p, getContext);
  },
  async getSelection(p, t) {
    return paginate(figma.currentPage.selection || [], p, getContext);
  },
  async getNodeInfo(p, t) {
    onlyKeys(p, ['id', 'depth']);
    const depth = p.depth === undefined ? 3 : requireNum(p.depth, 'depth', 0, 6);
    if (!Number.isInteger(depth)) throw appErr('INVALID_PARAM', 'depth 必须是整数');
    return buildNodeInfo(await getNode(p.id, t), depth);
  },
};
