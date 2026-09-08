// Capability discovery report. Aggregates per-domain metadata declared by each
// domain module; availability is factual, never inferred from tool presence.
import { getContext } from './context.js';
import { HANDLERS } from './entry.js';
import { domainMeta as readLayerMeta } from './read-layer.js';
import { domainMeta as assetsMeta } from './assets.js';
import { domainMeta as hierarchyMeta } from './hierarchy.js';
import { domainMeta as vectorMeta } from './vector.js';
import { domainMeta as layoutMeta } from './layout.js';
import { domainMeta as textRangeMeta } from './text-range.js';
import { domainMeta as visualMeta } from './visual.js';
import { domainMeta as designSystemMeta } from './design-system.js';
import { domainMeta as prototypeMeta } from './prototype.js';
import { domainMeta as motionMeta } from './motion.js';
import { domainMeta as figjamMeta } from './figjam.js';
import { domainMeta as slidesMeta } from './slides.js';

const DOMAINS = [
  { name: 'read', label: '信息读取', commands: ['getContext', 'getSelection', 'getNodeInfo'], meta: null },
  { name: 'semantic-read', label: '语义查询与续读', meta: readLayerMeta },
  { name: 'pages', label: '页面管理', commands: ['listPages', 'managePage'], meta: null },
  { name: 'assets', label: '资源与截图', meta: assetsMeta },
  { name: 'edit', label: '基础编辑', commands: ['createNode', 'modifyNode', 'deleteNode', 'setText'], meta: null },
  { name: 'hierarchy', label: '层级操作', meta: hierarchyMeta },
  { name: 'vector', label: '矢量几何', meta: vectorMeta },
  { name: 'layout', label: '布局', meta: layoutMeta },
  { name: 'text-range', label: '富文本区间', meta: textRangeMeta },
  { name: 'visual', label: '视觉属性', meta: visualMeta },
  { name: 'design-system', label: '设计系统', meta: designSystemMeta },
  { name: 'prototype', label: '原型与批量', meta: prototypeMeta },
  { name: 'motion', label: '动画与视频', meta: motionMeta },
  { name: 'figjam', label: 'FigJam', meta: figjamMeta },
  { name: 'slides', label: 'Slides', meta: slidesMeta },
];

export function capabilityReport() {
  const context = getContext();
  const editorSupported = {
    pages: context.editorType === 'figma',
    assets: context.editorType === 'figma' || context.editorType === 'slides',
    edit: context.editorType === 'figma',
    hierarchy: context.editorType === 'figma',
    vector: context.editorType === 'figma',
    layout: context.editorType === 'figma',
    'text-range': context.editorType === 'figma',
    visual: context.editorType === 'figma',
    'design-system': context.editorType === 'figma',
    prototype: context.editorType === 'figma',
    motion: context.editorType === 'figma',
    figjam: context.editorType === 'figjam',
    slides: context.editorType === 'slides',
    read: true, 'semantic-read': true,
  };
  const domains = DOMAINS.map(domain => {
    const implemented = domain.meta !== null
      ? domain.meta.actions.length > 0
      : Array.isArray(domain.commands) && domain.commands.length > 0 &&
        domain.commands.every(command => Object.prototype.hasOwnProperty.call(HANDLERS, command));
    return {
      name: domain.name, label: domain.label,
      status: !editorSupported[domain.name] ? 'editor-unsupported'
        : implemented ? 'implemented' : 'not-implemented',
      actions: domain.meta ? domain.meta.actions : domain.commands,
      preconditions: domain.meta ? domain.meta.preconditions || [] : [],
      notes: domain.meta ? domain.meta.notes || [] : [],
      verified: false,
    };
  });
  return {
    ...context,
    protocol: 3,
    acceptance: { automatedTests: true, realCanvas: 'pending' },
    implementedCommands: Object.keys(HANDLERS).sort(),
    domains,
    editorNotes: {
      figma: context.editorType === 'figma' ? 'Design 编辑可用' : null,
      figjam: context.editorType === 'figjam' ? 'FigJam 编辑可用' : null,
      slides: context.editorType === 'slides' ? 'Slides 编辑可用' : null,
    },
  };
}
