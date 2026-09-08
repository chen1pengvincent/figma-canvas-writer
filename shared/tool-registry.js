// Shared command/tool registry: single source of truth for tool schemas,
// write classification, editor support and batch exclusions. Pure JS so both
// the Node bridge and the bundled Figma plugin can consume the same contract.

const str = (maxLength = 1024, minLength = 1) => ({ type: 'string', minLength, maxLength });
const str0 = (maxLength = 1024) => ({ type: 'string', maxLength });
const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const bool = { type: 'boolean' };
const object = (properties, required = [], additional = false) => ({
  type: 'object', properties, required, ...(additional === false ? { additionalProperties: false } : {}),
});
const array = (items, opts = {}) => ({ type: 'array', items, ...opts });
const idStr = () => str(1024);
const cursorSchema = { type: 'string', pattern: '^(0|[1-9][0-9]*|h_[0-9a-z]{4,32})$', maxLength: 36 };
const pagination = { cursor: cursorSchema, limit: integer(1, 100) };

const rgb = object({ r: number(0, 1), g: number(0, 1), b: number(0, 1), a: number(0, 1) }, ['r', 'g', 'b']);
const colorSchema = { anyOf: [rgb, { type: 'string', pattern: '^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$' }] };
const fontNameSchema = object({ family: str(512), style: str(512) }, ['family', 'style']);
const operationIdSchema = str(128);

const TARGET = {
  sessionId: idStr(), pageId: idStr(), pageRevision: integer(0, 2147483647),
};
const TARGET_REQUIRED = ['sessionId', 'pageId', 'pageRevision'];

// ---- paint/props (kept identical to the existing public contract) ---------
const matrix = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'number' } } };
const paint = object({
  type: { type: 'string', enum: ['SOLID', 'GRADIENT_LINEAR', 'GRADIENT_RADIAL', 'GRADIENT_ANGULAR', 'GRADIENT_DIAMOND', 'IMAGE', 'VIDEO', 'EMOJI'] },
  color: colorSchema,
  opacity: number(0, 1), visible: bool, blendMode: str(),
  boundVariables: object({ color: object({ type: { type: 'string', enum: ['VARIABLE_ALIAS'] }, id: str() }, ['type', 'id']) }),
  gradientTransform: matrix,
  gradientStops: array(object({ position: number(0, 1), color: rgb }, ['position', 'color']), { maxItems: 256 }),
  scaleMode: { type: 'string', enum: ['FILL', 'FIT', 'CROP', 'TILE'] },
  imageHash: { anyOf: [str(), { type: 'null' }] }, imageTransform: matrix,
  scalingFactor: number(0, 1e6), rotation: number(-360, 360),
  filters: object(Object.fromEntries(['exposure', 'contrast', 'saturation', 'temperature', 'tint', 'highlights', 'shadows'].map(k => [k, number(-1, 1)]))),
  videoHash: str(), emoji: str(),
}, ['type']);
const paints = array(paint, { maxItems: 32 });
const propsSchema = object({
  name: str0(10000), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
  width: number(0.01, 1e5), height: number(0, 1e5), rotation: number(-360, 360),
  opacity: number(0, 1), visible: bool, fills: paints, strokes: paints,
  strokeWeight: number(0, 1e5), cornerRadius: number(0, 1e5),
});

// ---- registry --------------------------------------------------------------
const R = {
  figma_canvas_status: {
    name: 'figma_canvas_status', command: null, classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: false, control: true,
    description: '读取本机桥接状态及已授权插件的真实上下文；先取得 sessionId/pageId/pageRevision 再调用目标工具。',
    inputSchema: object({}),
  },
  figma_get_capabilities: {
    name: 'figma_get_capabilities', command: 'getCapabilities', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true, control: true,
    description: '返回当前编辑器、协议版本与每领域动作的实现状态、可用性、限额和受阻原因。',
    inputSchema: object(TARGET, TARGET_REQUIRED),
  },
  figma_get_context: {
    name: 'figma_get_context', command: 'getContext', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '分页读取当前页面顶层节点和上下文，默认每页 50 个。',
    inputSchema: object({ ...TARGET, ...pagination }, TARGET_REQUIRED),
  },
  figma_get_selection: {
    name: 'figma_get_selection', command: 'getSelection', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '分页读取当前选中节点和上下文，默认每页 50 个。',
    inputSchema: object({ ...TARGET, ...pagination }, TARGET_REQUIRED),
  },
  figma_get_node: {
    name: 'figma_get_node', command: 'getNodeInfo', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '读取一个节点摘要及有限深度的子节点；depth 为 0–6 的整数。',
    inputSchema: object({ ...TARGET, nodeId: idStr(), depth: integer(0, 6) }, [...TARGET_REQUIRED, 'nodeId']),
  },
  figma_get_operation: {
    name: 'figma_get_operation', command: 'getOperation', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true, control: true,
    description: '查询同一插件运行会话内写操作/作业的真实状态；超时后先查询，禁止换 operationId 重放未知写入。',
    inputSchema: object({ ...TARGET, operationId: operationIdSchema }, [...TARGET_REQUIRED, 'operationId']),
  },
  figma_query_nodes: {
    name: 'figma_query_nodes', command: 'queryNodes', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '在当前页面按类型/名称等受限条件查询节点，支持字段投影和分页；不接受任意谓词。',
    inputSchema: object({
      ...TARGET, ...pagination,
      type: str(64), nameContains: str(256), exactName: str(256),
      projection: array(str(64), { maxItems: 32 }),
    }, TARGET_REQUIRED),
  },
  figma_get_children: {
    name: 'figma_get_children', command: 'getChildren', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '按游标读取指定容器的一页子节点，成员列表固定；变化按约定失效或标记。',
    inputSchema: object({
      ...TARGET, ...pagination, nodeId: idStr(),
      projection: array(str(64), { maxItems: 32 }),
    }, [...TARGET_REQUIRED, 'nodeId']),
  },
  figma_read_field: {
    name: 'figma_read_field', command: 'readField', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '读取指定节点的一个或多个字段，区分 absent/mixed/unsupported/truncated；不给未读字段编造默认值。',
    inputSchema: object({
      ...TARGET,
      nodeIds: array(idStr(), { minItems: 1, maxItems: 100 }),
      fields: array(str(64), { minItems: 1, maxItems: 32 }),
      range: object({ start: integer(0, 1e9), end: integer(0, 1e9) }, ['start', 'end']),
    }, [...TARGET_REQUIRED, 'nodeIds', 'fields']),
  },
  figma_get_text_runs: {
    name: 'figma_get_text_runs', command: 'getTextRuns', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '读取文本节点的样式分段与正文分块；UTF-16 边界明确，续读按内容摘要失效。',
    inputSchema: object({ ...TARGET, nodeId: idStr(), cursor: cursorSchema }, [...TARGET_REQUIRED, 'nodeId']),
  },
  figma_get_design_context: {
    name: 'figma_get_design_context', command: 'getDesignContext', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: true,
    description: '返回布局、文字分段、组件与变量引用、资源清单及截图关联的结构化设计上下文；不生成业务代码。',
    inputSchema: object({
      ...TARGET,
      nodeId: idStr(), scope: { type: 'string', enum: ['page', 'node'] },
      include: array({ type: 'string', enum: ['layout', 'bounds', 'text', 'components', 'variables', 'styles', 'assets'] }, { maxItems: 7 }),
      depth: integer(0, 6),
    }, TARGET_REQUIRED),
  },
  figma_list_pages: {
    name: 'figma_list_pages', command: 'listPages', classification: 'read',
    editors: ['figma'], requiresTarget: true,
    description: '列出当前文档的页面，含当前页标识与页面修订。',
    inputSchema: object(TARGET, TARGET_REQUIRED),
  },
  figma_manage_page: {
    name: 'figma_manage_page', command: 'managePage', classification: 'context',
    editors: ['figma'], requiresTarget: true,
    description: '创建、重命名、删除或切换页面；切页单独对账，完成后需读取新上下文。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      action: { type: 'string', enum: ['create', 'rename', 'delete', 'switchPage'] },
      targetPageId: idStr(), pageName: str0(10000), expectedPageName: str0(10000),
      confirm: { type: 'string', enum: ['DELETE'] },
    }, [...TARGET_REQUIRED, 'operationId', 'action']),
  },
  figma_get_screenshot: {
    name: 'figma_get_screenshot', command: 'getScreenshot', classification: 'read',
    editors: ['figma'], requiresTarget: true,
    description: '导出指定节点的 PNG 截图；小图内联返回，大图自动落本机产物并返回句柄。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      longEdge: integer(64, 8192), destination: { type: 'string', enum: ['auto', 'inline', 'file'] },
    }, [...TARGET_REQUIRED, 'nodeId']),
  },
  figma_export_asset: {
    name: 'figma_export_asset', command: 'exportAsset', classification: 'file',
    editors: ['figma', 'slides'], requiresTarget: true,
    description: '导出节点为 PNG/JPG/SVG/PDF，写入配置的产物目录；返回路径、字节数与 SHA-256。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(),
      format: { type: 'string', enum: ['PNG', 'JPG', 'SVG', 'PDF'] },
      scale: number(0.01, 4), contentsOnly: bool, useAbsoluteBounds: bool,
      svgOutlineText: bool, svgIdAttribute: bool, svgSimplifyStroke: bool,
      destination: { type: 'string', enum: ['file', 'inline'] },
    }, [...TARGET_REQUIRED, 'operationId', 'nodeId', 'format']),
  },
  figma_import_asset: {
    name: 'figma_import_asset', command: 'importAsset', classification: 'file',
    editors: ['figma'], requiresTarget: true,
    description: '导入本机 PNG/JPEG 为持久图片填充，SVG 为可编辑矢量并放置；不接受 URL。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      filePath: str(4096), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
      parentId: idStr(), name: str0(10000),
    }, [...TARGET_REQUIRED, 'operationId', 'filePath']),
  },
  figma_read_asset: {
    name: 'figma_read_asset', command: 'readAsset', classification: 'read',
    editors: ['figma', 'figjam', 'slides'], requiresTarget: false,
    description: '读取本机产物的元数据（路径、大小、SHA-256、格式）；小型资源可含内联预览。',
    inputSchema: object({ artifactId: str(128) }, ['artifactId']),
  },
  figma_create_node: {
    name: 'figma_create_node', command: 'createNode', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '在已确认页面创建节点；operationId 是本次写入的唯一标识，相同 ID 不重复执行。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      type: { type: 'string', enum: ['RECTANGLE', 'ELLIPSE', 'TEXT', 'FRAME', 'LINE', 'STAR'] },
      parentId: idStr(), name: str0(10000), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
      width: number(0.01, 1e5), height: number(0, 1e5), text: str0(200000), props: propsSchema,
    }, [...TARGET_REQUIRED, 'operationId', 'type']),
  },  figma_modify_node: {
    name: 'figma_modify_node', command: 'modifyNode', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '修改节点白名单属性；须提供 sessionId/pageId/pageRevision/operationId。',
    inputSchema: object({ ...TARGET, operationId: operationIdSchema, nodeId: idStr(), props: propsSchema }, [...TARGET_REQUIRED, 'operationId', 'nodeId', 'props']),
  },
  figma_delete_node: {
    name: 'figma_delete_node', command: 'deleteNode', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '删除目标节点；须提供 operationId。',
    inputSchema: object({ ...TARGET, operationId: operationIdSchema, nodeId: idStr() }, [...TARGET_REQUIRED, 'operationId', 'nodeId']),
  },
  figma_set_text: {
    name: 'figma_set_text', command: 'setText', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '修改文本节点；省略 text 保留原文，可单独改字体、字号或位置。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(), text: str0(200000),
      fontName: fontNameSchema, fontSize: number(1, 1000), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
    }, [...TARGET_REQUIRED, 'operationId', 'nodeId']),
  },
  figma_hierarchy: {
    name: 'figma_hierarchy', command: 'hierarchy', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '层级操作：clone、group、ungroup、reparent、reorder；区分绝对位置与局部坐标，拒绝循环层级。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      action: { type: 'string', enum: ['clone', 'group', 'ungroup', 'reparent', 'reorder'] },
      nodeId: idStr(), nodeIds: array(idStr(), { minItems: 1, maxItems: 100 }),
      parentId: idStr(), position: { type: 'string', enum: ['keepAbsolute', 'keepLocal'] },
      index: integer(0, 10000), beforeNodeId: idStr(),
      name: str0(10000),
    }, [...TARGET_REQUIRED, 'operationId', 'action']),
  },
  figma_vector: {
    name: 'figma_vector', command: 'vector', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '矢量几何：多边形、矢量路径、布尔运算与形状参数；结果为可编辑节点。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      action: { type: 'string', enum: ['createPolygon', 'createVectorPaths', 'boolean', 'setShapeParams', 'setVectorNetwork'] },
      nodeId: idStr(), nodeIds: array(idStr(), { minItems: 2, maxItems: 2 }),
      operation: { type: 'string', enum: ['UNION', 'INTERSECT', 'SUBTRACT', 'EXCLUDE'] },
      parentId: idStr(), x: number(-1e6, 1e6), y: number(-1e6, 1e6),
      name: str0(10000), pointCount: integer(3, 60), innerRadius: number(0, 1),
      cornerRadius: number(0, 1e5), polygonWidth: number(1, 100000), polygonHeight: number(1, 100000),
      vectorNetwork: object({}, [], true),
      paths: array(object({}, [], true), { maxItems: 64 }),
    }, [...TARGET_REQUIRED, 'operationId', 'action']),
  },
  figma_layout: {
    name: 'figma_layout', command: 'layout', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: 'Auto Layout、间距、内边距、对齐、尺寸模式与约束的设置与移除。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(), childIds: array(idStr(), { maxItems: 100 }),
      action: { type: 'string', enum: ['setLayout', 'setChildLayout', 'removeLayout', 'setConstraints'] },
      props: object({
        layoutMode: { type: 'string', enum: ['NONE', 'HORIZONTAL', 'VERTICAL'] },
        primaryAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'] },
        counterAxisAlignItems: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'BASELINE'] },
        primaryAxisSizingMode: { type: 'string', enum: ['FIXED', 'AUTO'] },
        counterAxisSizingMode: { type: 'string', enum: ['FIXED', 'AUTO'] },
        itemSpacing: number(0, 1e5), counterAxisSpacing: number(0, 1e5),
        paddingLeft: number(0, 1e5), paddingRight: number(0, 1e5), paddingTop: number(0, 1e5), paddingBottom: number(0, 1e5),
        layoutWrap: { type: 'string', enum: ['NO_WRAP', 'WRAP'] },
        minWidth: number(0, 1e5), maxWidth: number(0, 1e5), minHeight: number(0, 1e5), maxHeight: number(0, 1e5),
        layoutAlign: { type: 'string', enum: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'INHERIT'] },
        layoutGrow: number(0, 1), layoutPositioning: { type: 'string', enum: ['AUTO', 'ABSOLUTE'] },
        layoutSizingHorizontal: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] },
        layoutSizingVertical: { type: 'string', enum: ['FIXED', 'HUG', 'FILL'] },
        horizontalConstraint: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] },
        verticalConstraint: { type: 'string', enum: ['MIN', 'MAX', 'CENTER', 'STRETCH', 'SCALE'] },
      }),
    }, [...TARGET_REQUIRED, 'operationId', 'action']),
  },
  figma_text_range: {
    name: 'figma_text_range', command: 'textRange', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: '读取或修改文本节点的字符区间样式；UTF-16 边界明确，加载失败不静默替换字体。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      action: { type: 'string', enum: ['getStyles', 'setStyles'] },
      start: integer(0, 1e9), end: integer(0, 1e9),
      styles: object({
        fontName: fontNameSchema, fontSize: number(1, 1000),
        lineHeight: { anyOf: [number(0, 1e5), object({ unit: { type: 'string', enum: ['PIXELS', 'PERCENT', 'AUTO'] }, value: number(0, 1e5) }, ['unit', 'value'])] },
        letterSpacing: { anyOf: [number(-1e5, 1e5), object({ unit: { type: 'string', enum: ['PIXELS', 'PERCENT'] }, value: number(-1e5, 1e5) }, ['unit', 'value'])] },
        fills: paints, textCase: { type: 'string', enum: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'] },
        textDecoration: { type: 'string', enum: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] },
      }),
      cursor: cursorSchema,
    }, [...TARGET_REQUIRED, 'nodeId', 'action']),
  },
  figma_visual: {
    name: 'figma_visual', command: 'visual', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '视觉属性：effects、混合、容器裁切、遮罩、网格、描边细节与分角圆角；按节点类型校验。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(),
      action: { type: 'string', enum: ['setEffects', 'setBlend', 'setClip', 'setMask', 'setGrids', 'setStrokeDetail', 'setCornerRadii'] },
      props: object({
        effects: array(object({}, [], true), { maxItems: 32 }),
        blendMode: str(64),
        clipsContent: bool, isMask: bool, maskType: { type: 'string', enum: ['ALPHA', 'LUMINANCE', 'VECTOR'] },
        layoutGrids: array(object({}, [], true), { maxItems: 16 }),
        strokeAlign: { type: 'string', enum: ['INSIDE', 'OUTSIDE', 'CENTER'] },
        strokeCap: { type: 'string', enum: ['NONE', 'ROUND', 'SQUARE', 'ARROW_LINES', 'ARROW_EQUILATERAL'] },
        strokeJoin: { type: 'string', enum: ['MITER', 'BEVEL', 'ROUND'] },
        strokeMiterLimit: number(0, 1000), dashPattern: array(number(0, 1e5), { maxItems: 32 }),
        strokeTopWeight: number(0, 1e5), strokeBottomWeight: number(0, 1e5),
        strokeLeftWeight: number(0, 1e5), strokeRightWeight: number(0, 1e5),
        topLeftRadius: number(0, 1e5), topRightRadius: number(0, 1e5),
        bottomLeftRadius: number(0, 1e5), bottomRightRadius: number(0, 1e5),
        cornerSmoothing: number(0, 1),
      }),
    }, [...TARGET_REQUIRED, 'operationId', 'nodeId', 'action']),
  },
  figma_variables: {
    name: 'figma_variables', command: 'variables', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: '本地变量集合、变量、模式、值、别名与节点绑定；循环/类型冲突返回真实错误。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      action: { type: 'string', enum: ['listCollections', 'listVariables', 'getVariable', 'createVariable', 'renameVariable', 'deleteVariable',
        'setValue', 'createMode', 'renameMode', 'deleteMode', 'resolveValue', 'setBoundVariable'] },
      collectionId: idStr(), variableId: idStr(), modeId: idStr(), field: str(64),
      name: str0(512), resolvedType: { type: 'string', enum: ['BOOLEAN', 'FLOAT', 'COLOR', 'STRING'] },
      value: { anyOf: [number(-1e12, 1e12), bool, str0(4096), object({}, [], true)] },
      expectedCollectionName: str0(512),
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_styles: {
    name: 'figma_styles', command: 'styles', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: '本地共享 Paint/Text/Effect/Grid 样式的查询、创建、修改与应用；不包含团队库发布。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      action: { type: 'string', enum: ['list', 'get', 'create', 'update', 'apply', 'delete'] },
      styleType: { type: 'string', enum: ['PAINT', 'TEXT', 'EFFECT', 'GRID'] },
      styleId: idStr(), name: str0(512),
      props: object({
        paints: paints, type: str(64), fontSize: number(1, 1000),
        textDecoration: { type: 'string', enum: ['NONE', 'UNDERLINE', 'STRIKETHROUGH'] },
        fontName: fontNameSchema, letterSpacing: number(-1e5, 1e5), lineHeight: number(0, 1e5),
        paragraphSpacing: number(0, 1e5), textCase: { type: 'string', enum: ['ORIGINAL', 'UPPER', 'LOWER', 'TITLE', 'SMALL_CAPS', 'SMALL_CAPS_FORCED'] },
        effects: array(object({}, [], true), { maxItems: 32 }),
        layoutGrids: array(object({}, [], true), { maxItems: 16 }),
      }),
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_components: {
    name: 'figma_components', command: 'components', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: '组件/变体/实例的创建、属性、关联、交换、分离与说明；实例引用与覆盖可核验。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(), componentId: idStr(), instanceId: idStr(),
      action: { type: 'string', enum: ['list', 'createFromNode', 'createInstance', 'combineAsVariants', 'swap', 'detach',
        'getInstanceInfo', 'setInstanceProperty', 'addComponentProperty', 'editComponentProperty', 'deleteComponentProperty'] },
      x: number(-1e6, 1e6), y: number(-1e6, 1e6), name: str0(512),
      parentId: idStr(), nodeIds: array(idStr(), { minItems: 2, maxItems: 64 }),
      propertyName: str0(512),
      propertyType: { type: 'string', enum: ['BOOLEAN', 'TEXT', 'INSTANCE_SWAP', 'VARIANT'] },
      value: { anyOf: [bool, str0(4096), { type: 'null' }] },
      defaultValue: { anyOf: [bool, str0(4096)] },
      variantOptions: array(str0(512), { maxItems: 64 }),
      description: str0(16384),
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_libraries: {
    name: 'figma_libraries', command: 'libraries', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: '发现当前文件已启用库的变量集合/变量，并按已知 key 导入原生允许的变量、组件与样式。',
    inputSchema: object({
      ...TARGET,
      action: { type: 'string', enum: ['listCollections', 'listVariables', 'importVariable', 'importComponent', 'importStyle'] },
      collectionKey: idStr(), variableKey: idStr(), componentKey: idStr(), styleKey: idStr(),
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_set_reactions: {
    name: 'figma_set_reactions', command: 'setReactions', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '读取、设置或清除原型 reactions；关键导航与返回须实际点击验收。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(),
      action: { type: 'string', enum: ['set', 'clear'] },
      reactions: array(object({
        trigger: object({ type: { type: 'string', enum: ['ON_CLICK', 'ON_HOVER', 'ON_PRESS', 'ON_DRAG', 'AFTER_TIMEOUT', 'MOUSE_ENTER', 'MOUSE_LEAVE', 'MOUSE_UP', 'MOUSE_DOWN'] }, timeout: number(0, 1e6) }, ['type']),
        action: object({ type: { type: 'string', enum: ['BACK', 'CLOSE', 'LINK', 'NAVIGATE', 'NODE', 'OPEN_LINK', 'SET_VARIABLE', 'UPDATE_MEDIA_RUNTIME', 'URL'] }, destinationId: idStr(), navigation: { type: 'string', enum: ['NAVIGATE', 'SWAP', 'OVERLAY'] }, transition: object({ type: { type: 'string', enum: ['MOVE_IN', 'MOVE_OUT', 'PUSH', 'SLIDE_IN', 'SLIDE_OUT', 'DISSOLVE', 'SMART_ANIMATE', 'SCROLL_ANIMATE'] }, duration: number(0, 10000), easing: object({ type: { type: 'string', enum: ['EASE_IN', 'EASE_OUT', 'EASE_IN_AND_OUT', 'LINEAR'] } }, ['type']) }), url: str(4096), preserveScrollPosition: bool, overlayRelativePosition: object({ x: number(-1e6, 1e6), y: number(-1e6, 1e6) }, ['x', 'y']) }, ['type']),
      }, ['trigger', 'action']), { maxItems: 64 }),
      prototypeStartNodeId: { anyOf: [idStr(), { type: 'null' }] },
    }, [...TARGET_REQUIRED, 'operationId', 'nodeId', 'action']),
  },
  figma_batch: {
    name: 'figma_batch', command: 'batch', classification: 'write',
    editors: ['figma'], requiresTarget: true,
    description: '顺序执行最多 50 个已注册动作，可引用前序结果；失败默认停止，返回逐项状态。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema,
      steps: array(object({ command: str(64), params: object({}, [], true) }, ['command', 'params']), { minItems: 1, maxItems: 50 }),
      continueOnError: bool,
    }, [...TARGET_REQUIRED, 'operationId', 'steps']),
  },
  figma_motion: {
    name: 'figma_motion', command: 'motion', classification: 'mixed',
    editors: ['figma'], requiresTarget: true,
    description: 'Motion 动画：样式发现、节点时间线/轨道读写与关键帧轨道应用；不生成业务代码。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      action: { type: 'string', enum: ['listAnimationStyles', 'readNode', 'applyStyle', 'removeStyle', 'applyTrack', 'removeTrack', 'setDuration'] },
      styleId: idStr(), duration: number(0, 1e6),
      field: object({ type: { type: 'string', enum: ['PROPERTY', 'PAINT', 'EFFECT'] }, name: str(64), index: integer(0, 64) }, ['type', 'name']),
      track: object({ baseValue: object({}, [], true), keyframes: array(object({ timelinePosition: number(0, 1e6), value: object({}, [], true) }, ['timelinePosition', 'value']), { maxItems: 512 }) }, ['baseValue', 'keyframes']),
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_export_video: {
    name: 'figma_export_video', command: 'exportVideo', classification: 'job',
    editors: ['figma'], requiresTarget: true,
    description: '导出带动画的顶层 Frame 为 MP4，写入产物目录；返回作业 ID 后轮询对账。',
    inputSchema: object({
      ...TARGET, operationId: operationIdSchema, nodeId: idStr(),
      format: { type: 'string', enum: ['MP4'] },
      fps: { type: 'integer', enum: [12, 24, 30, 60] },
      quality: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH'] },
      scale: { type: 'number', enum: [0.5, 0.75, 1, 1.5, 2, 3, 4] },
      width: integer(1, 3840), height: integer(1, 3840),
    }, [...TARGET_REQUIRED, 'operationId', 'nodeId']),
  },
  figma_shaders: {
    name: 'figma_shaders', command: 'shaders', classification: 'read',
    editors: ['figma'], requiresTarget: true,
    description: '列出当前文件可用的 Shader 及其可读公开配置；不导入、不应用、不修改。',
    inputSchema: object({ ...TARGET, cursor: cursorSchema }, TARGET_REQUIRED),
  },
  figma_figjam: {
    name: 'figma_figjam', command: 'figjam', classification: 'mixed',
    editors: ['figjam'], requiresTarget: true,
    description: '在已打开的 FigJam 中创建/修改便笺、带文字形状与连接线，并读取原生可编辑结果。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(),
      action: { type: 'string', enum: ['createSticky', 'updateSticky', 'createShapeWithText', 'createConnector', 'updateConnector', 'listNodes'] },
      x: number(-1e6, 1e6), y: number(-1e6, 1e6), width: number(1, 1e5), height: number(1, 1e5),
      text: str0(200000), name: str0(10000), cursor: cursorSchema, limit: integer(1, 100),
      startNodeId: idStr(), endNodeId: idStr(), startMagnet: { type: 'string', enum: ['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'CENTER'] }, endMagnet: { type: 'string', enum: ['AUTO', 'TOP', 'BOTTOM', 'LEFT', 'RIGHT', 'CENTER'] },
      shapeType: { type: 'string', enum: ['SQUARE', 'ELLIPSE', 'DIAMOND', 'TRIANGLE_UP', 'TRIANGLE_DOWN', 'ROUNDED_RECTANGLE', 'HEXAGON', 'CLOUD', 'PARALLELOGRAM_RIGHT', 'PARALLELOGRAM_LEFT', 'STAR', 'SPEECH_BUBBLE', 'PIE'] },
    }, [...TARGET_REQUIRED, 'action']),
  },
  figma_slides: {
    name: 'figma_slides', command: 'slides', classification: 'mixed',
    editors: ['slides'], requiresTarget: true,
    description: '在已打开的 Slides 中读取结构并按明确内容/位置创建修改幻灯片与受支持内容节点。',
    inputSchema: object({
      ...TARGET, nodeId: idStr(), slideId: idStr(), rowId: idStr(),
      action: { type: 'string', enum: ['listStructure', 'createSlide', 'createSlideRow', 'addContent', 'updateContent'] },
      content: object({ type: { type: 'string', enum: ['FRAME', 'RECTANGLE', 'ELLIPSE', 'TEXT', 'LINE'] }, x: number(-1e6, 1e6), y: number(-1e6, 1e6), width: number(1, 1e5), height: number(1, 1e5), text: str0(200000), name: str0(10000), fontSize: number(1, 1000), fills: paints }, ['type']),
      order: { type: 'string', enum: ['start', 'end', 'before', 'after'] }, relativeToId: idStr(),
    }, [...TARGET_REQUIRED, 'action']),
  },
};

// ---- derived helpers -------------------------------------------------------
// Mutating actions of mixed tools; used to require operationId conditionally
// via if/then on both the MCP schema and the runtime write classification.
export const WRITE_ACTIONS_BY_COMMAND = {
  variables: ['createVariable', 'renameVariable', 'deleteVariable', 'setValue', 'createMode', 'renameMode', 'deleteMode', 'setBoundVariable'],
  styles: ['create', 'update', 'apply', 'delete'],
  components: ['createFromNode', 'createInstance', 'combineAsVariants', 'swap', 'detach', 'setInstanceProperty', 'addComponentProperty', 'editComponentProperty', 'deleteComponentProperty'],
  libraries: ['importVariable', 'importComponent', 'importStyle'],
  textRange: ['setStyles'],
  motion: ['applyStyle', 'removeStyle', 'applyTrack', 'removeTrack', 'setDuration'],
  figjam: ['createSticky', 'updateSticky', 'createShapeWithText', 'createConnector', 'updateConnector'],
  slides: ['createSlide', 'createSlideRow', 'addContent', 'updateContent'],
};
for (const tool of Object.values(R)) {
  if (tool.classification !== 'mixed') continue;
  const actions = WRITE_ACTIONS_BY_COMMAND[tool.command] || [];
  if (actions.length === 0) continue;
  tool.inputSchema.properties.operationId = operationIdSchema;
  tool.inputSchema.allOf = [{
    if: { properties: { action: { enum: actions } } },
    then: { required: ['operationId'] },
  }];
}
// Legacy create_node contract: TEXT requires explicit text; only LINE may omit height.
R.figma_create_node.inputSchema.allOf = [
  { if: { properties: { type: { const: 'TEXT' } } }, then: { required: ['text'] } },
  { if: { properties: { type: { const: 'LINE' } } }, else: { properties: { height: { minimum: 0.01 } } } },
];

export const TOOLS = R;
export const toolFor = name => TOOLS[name] || null;
export const COMMANDS = new Map(Object.values(TOOLS).filter(t => t.command).map(t => [t.command, t]));
export const WRITE_COMMANDS = new Set(Object.values(TOOLS).filter(t => ['write', 'file', 'job', 'context'].includes(t.classification)).map(t => t.command));

// A call is a write when the tool is classified write/file/job/context, or a
// mixed tool invoked with a mutating action. Both sides use this same function.
export function isWriteCall(command, params) {
  const tool = COMMANDS.get(command);
  if (!tool) return false;
  if (['write', 'file', 'job', 'context'].includes(tool.classification)) return true;
  if (tool.classification !== 'mixed') return false;
  const set = WRITE_ACTIONS_BY_COMMAND[command];
  return !!set && !!params && set.includes(params.action);
}

export function toolsForListing() {
  return Object.values(TOOLS).map(({ command, classification, requiresTarget, editors, control, ...rest }) => rest);
}
