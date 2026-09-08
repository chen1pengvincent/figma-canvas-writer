// Page listing and management. Switching pages is a standalone context
// operation with its own reconciliation; never mixed into a normal batch.
import { appErr, requireStr, onlyKeys } from './util.js';
import { getContext, assertTarget, assertAuthGeneration } from './context.js';

export const handlers = {
  async listPages(p, t) {
    onlyKeys(p, []);
    assertTarget(t);
    const pages = figma.root.children.filter(child => child.type === 'PAGE');
    return {
      ...getContext(),
      pages: pages.map(page => ({
        id: page.id, name: String(page.name).slice(0, 1024),
        isCurrent: page.id === figma.currentPage.id,
        childCount: (page.children || []).length,
      })),
    };
  },
  async managePage(p, t) {
    onlyKeys(p, ['action', 'targetPageId', 'pageName', 'expectedPageName', 'confirm']);
    if (figma.editorType !== 'figma') throw appErr('EDITOR_UNSUPPORTED', '页面管理仅在 Figma Design 文件中可用');
    assertTarget(t);
    if (p.action === 'create') {
      requireStr(p.pageName, 'pageName');
      const page = figma.createPage();
      page.name = p.pageName;
      return { ...getContext(), created: { id: page.id, name: page.name } };
    }
    if (p.action === 'list') return handlers.listPages({}, t);
    const page = await findPage(p.targetPageId);
    if (p.action === 'rename') {
      requireStr(p.pageName, 'pageName');
      page.name = p.pageName;
      return { ...getContext(), renamed: { id: page.id, name: page.name } };
    }
    if (p.action === 'delete') {
      if (p.confirm !== 'DELETE') throw appErr('INVALID_PARAM', '删除页面必须提供 confirm: "DELETE"');
      if (p.expectedPageName !== undefined && String(page.name) !== p.expectedPageName) {
        throw appErr('TARGET_MISMATCH', '页面名称与预期不符，已拒绝删除');
      }
      if (page.id === figma.currentPage.id) throw appErr('INVALID_TARGET', '不能删除当前页面，请先切页');
      page.remove();
      return { ...getContext(), deleted: { id: page.id } };
    }
    if (p.action === 'switchPage') {
      if (page.id === figma.currentPage.id) return { ...getContext(), switched: true };
      const sourcePageId = figma.currentPage.id;
      const targetPageId = page.id;
      // The currentpagechange listener bumps the page revision and publishes
      // the new context; this handler only verifies the authorization survives.
      await figma.setCurrentPageAsync(page);
      assertAuthGeneration(t);
      return { ...getContext(), switched: true, sourcePageId, targetPageId };
    }
    throw appErr('INVALID_PARAM', '未知页面动作');
  },
};

async function findPage(pageId) {
  requireStr(pageId, 'pageId');
  const page = figma.root.children.find(child => child.type === 'PAGE' && child.id === pageId);
  if (!page) throw appErr('PAGE_NOT_FOUND', '找不到目标页面');
  return page;
}
