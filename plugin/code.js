// GENERATED FILE: build with `npm run build:plugin` in bridge/; do not edit directly.
(() => {
  // shared/tool-registry.js
  var str = (maxLength = 1024, minLength = 1) => ({ type: "string", minLength, maxLength });
  var str0 = (maxLength = 1024) => ({ type: "string", maxLength });
  var number = (minimum, maximum) => ({ type: "number", minimum, maximum });
  var integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });
  var bool = { type: "boolean" };
  var object = (properties, required = [], additional = false) => ({
    type: "object",
    properties,
    required,
    ...additional === false ? { additionalProperties: false } : {}
  });
  var array = (items, opts = {}) => ({ type: "array", items, ...opts });
  var idStr = () => str(1024);
  var cursorSchema = { type: "string", pattern: "^(0|[1-9][0-9]*|h_[0-9a-z]{4,32})$", maxLength: 36 };
  var pagination = { cursor: cursorSchema, limit: integer(1, 100) };
  var rgb = object({ r: number(0, 1), g: number(0, 1), b: number(0, 1), a: number(0, 1) }, ["r", "g", "b"]);
  var colorSchema = { anyOf: [rgb, { type: "string", pattern: "^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$" }] };
  var fontNameSchema = object({ family: str(512), style: str(512) }, ["family", "style"]);
  var operationIdSchema = str(128);
  var TARGET = {
    sessionId: idStr(),
    pageId: idStr(),
    pageRevision: integer(0, 2147483647)
  };
  var TARGET_REQUIRED = ["sessionId", "pageId", "pageRevision"];
  var matrix = { type: "array", minItems: 2, maxItems: 2, items: { type: "array", minItems: 3, maxItems: 3, items: { type: "number" } } };
  var paint = object({
    type: { type: "string", enum: ["SOLID", "GRADIENT_LINEAR", "GRADIENT_RADIAL", "GRADIENT_ANGULAR", "GRADIENT_DIAMOND", "IMAGE", "VIDEO", "EMOJI"] },
    color: colorSchema,
    opacity: number(0, 1),
    visible: bool,
    blendMode: str(),
    boundVariables: object({ color: object({ type: { type: "string", enum: ["VARIABLE_ALIAS"] }, id: str() }, ["type", "id"]) }),
    gradientTransform: matrix,
    gradientStops: array(object({ position: number(0, 1), color: rgb }, ["position", "color"]), { maxItems: 256 }),
    scaleMode: { type: "string", enum: ["FILL", "FIT", "CROP", "TILE"] },
    imageHash: { anyOf: [str(), { type: "null" }] },
    imageTransform: matrix,
    scalingFactor: number(0, 1e6),
    rotation: number(-360, 360),
    filters: object(Object.fromEntries(["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"].map((k) => [k, number(-1, 1)]))),
    videoHash: str(),
    emoji: str()
  }, ["type"]);
  var paints = array(paint, { maxItems: 32 });
  var propsSchema = object({
    name: str0(1e4),
    x: number(-1e6, 1e6),
    y: number(-1e6, 1e6),
    width: number(0.01, 1e5),
    height: number(0, 1e5),
    rotation: number(-360, 360),
    opacity: number(0, 1),
    visible: bool,
    fills: paints,
    strokes: paints,
    strokeWeight: number(0, 1e5),
    cornerRadius: number(0, 1e5)
  });
  var R = {
    figma_canvas_status: {
      name: "figma_canvas_status",
      command: null,
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: false,
      control: true,
      description: "\u8BFB\u53D6\u672C\u673A\u6865\u63A5\u72B6\u6001\u53CA\u5DF2\u6388\u6743\u63D2\u4EF6\u7684\u771F\u5B9E\u4E0A\u4E0B\u6587\uFF1B\u5148\u53D6\u5F97 sessionId/pageId/pageRevision \u518D\u8C03\u7528\u76EE\u6807\u5DE5\u5177\u3002",
      inputSchema: object({})
    },
    figma_get_capabilities: {
      name: "figma_get_capabilities",
      command: "getCapabilities",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      control: true,
      description: "\u8FD4\u56DE\u5F53\u524D\u7F16\u8F91\u5668\u3001\u534F\u8BAE\u7248\u672C\u4E0E\u6BCF\u9886\u57DF\u52A8\u4F5C\u7684\u5B9E\u73B0\u72B6\u6001\u3001\u53EF\u7528\u6027\u3001\u9650\u989D\u548C\u53D7\u963B\u539F\u56E0\u3002",
      inputSchema: object(TARGET, TARGET_REQUIRED)
    },
    figma_get_context: {
      name: "figma_get_context",
      command: "getContext",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u5206\u9875\u8BFB\u53D6\u5F53\u524D\u9875\u9762\u9876\u5C42\u8282\u70B9\u548C\u4E0A\u4E0B\u6587\uFF0C\u9ED8\u8BA4\u6BCF\u9875 50 \u4E2A\u3002",
      inputSchema: object({ ...TARGET, ...pagination }, TARGET_REQUIRED)
    },
    figma_get_selection: {
      name: "figma_get_selection",
      command: "getSelection",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u5206\u9875\u8BFB\u53D6\u5F53\u524D\u9009\u4E2D\u8282\u70B9\u548C\u4E0A\u4E0B\u6587\uFF0C\u9ED8\u8BA4\u6BCF\u9875 50 \u4E2A\u3002",
      inputSchema: object({ ...TARGET, ...pagination }, TARGET_REQUIRED)
    },
    figma_get_node: {
      name: "figma_get_node",
      command: "getNodeInfo",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u8BFB\u53D6\u4E00\u4E2A\u8282\u70B9\u6458\u8981\u53CA\u6709\u9650\u6DF1\u5EA6\u7684\u5B50\u8282\u70B9\uFF1Bdepth \u4E3A 0\u20136 \u7684\u6574\u6570\u3002",
      inputSchema: object({ ...TARGET, nodeId: idStr(), depth: integer(0, 6) }, [...TARGET_REQUIRED, "nodeId"])
    },
    figma_get_operation: {
      name: "figma_get_operation",
      command: "getOperation",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      control: true,
      description: "\u67E5\u8BE2\u540C\u4E00\u63D2\u4EF6\u8FD0\u884C\u4F1A\u8BDD\u5185\u5199\u64CD\u4F5C/\u4F5C\u4E1A\u7684\u771F\u5B9E\u72B6\u6001\uFF1B\u8D85\u65F6\u540E\u5148\u67E5\u8BE2\uFF0C\u7981\u6B62\u6362 operationId \u91CD\u653E\u672A\u77E5\u5199\u5165\u3002",
      inputSchema: object({ ...TARGET, operationId: operationIdSchema }, [...TARGET_REQUIRED, "operationId"])
    },
    figma_query_nodes: {
      name: "figma_query_nodes",
      command: "queryNodes",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u5728\u5F53\u524D\u9875\u9762\u6309\u7C7B\u578B/\u540D\u79F0\u7B49\u53D7\u9650\u6761\u4EF6\u67E5\u8BE2\u8282\u70B9\uFF0C\u652F\u6301\u5B57\u6BB5\u6295\u5F71\u548C\u5206\u9875\uFF1B\u4E0D\u63A5\u53D7\u4EFB\u610F\u8C13\u8BCD\u3002",
      inputSchema: object({
        ...TARGET,
        ...pagination,
        type: str(64),
        nameContains: str(256),
        exactName: str(256),
        projection: array(str(64), { maxItems: 32 })
      }, TARGET_REQUIRED)
    },
    figma_get_children: {
      name: "figma_get_children",
      command: "getChildren",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u6309\u6E38\u6807\u8BFB\u53D6\u6307\u5B9A\u5BB9\u5668\u7684\u4E00\u9875\u5B50\u8282\u70B9\uFF0C\u6210\u5458\u5217\u8868\u56FA\u5B9A\uFF1B\u53D8\u5316\u6309\u7EA6\u5B9A\u5931\u6548\u6216\u6807\u8BB0\u3002",
      inputSchema: object({
        ...TARGET,
        ...pagination,
        nodeId: idStr(),
        projection: array(str(64), { maxItems: 32 })
      }, [...TARGET_REQUIRED, "nodeId"])
    },
    figma_read_field: {
      name: "figma_read_field",
      command: "readField",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u8BFB\u53D6\u6307\u5B9A\u8282\u70B9\u7684\u4E00\u4E2A\u6216\u591A\u4E2A\u5B57\u6BB5\uFF0C\u533A\u5206 absent/mixed/unsupported/truncated\uFF1B\u4E0D\u7ED9\u672A\u8BFB\u5B57\u6BB5\u7F16\u9020\u9ED8\u8BA4\u503C\u3002",
      inputSchema: object({
        ...TARGET,
        nodeIds: array(idStr(), { minItems: 1, maxItems: 100 }),
        fields: array(str(64), { minItems: 1, maxItems: 32 }),
        range: object({ start: integer(0, 1e9), end: integer(0, 1e9) }, ["start", "end"])
      }, [...TARGET_REQUIRED, "nodeIds", "fields"])
    },
    figma_get_text_runs: {
      name: "figma_get_text_runs",
      command: "getTextRuns",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u8BFB\u53D6\u6587\u672C\u8282\u70B9\u7684\u6837\u5F0F\u5206\u6BB5\u4E0E\u6B63\u6587\u5206\u5757\uFF1BUTF-16 \u8FB9\u754C\u660E\u786E\uFF0C\u7EED\u8BFB\u6309\u5185\u5BB9\u6458\u8981\u5931\u6548\u3002",
      inputSchema: object({ ...TARGET, nodeId: idStr(), cursor: cursorSchema }, [...TARGET_REQUIRED, "nodeId"])
    },
    figma_get_design_context: {
      name: "figma_get_design_context",
      command: "getDesignContext",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: true,
      description: "\u8FD4\u56DE\u5E03\u5C40\u3001\u6587\u5B57\u5206\u6BB5\u3001\u7EC4\u4EF6\u4E0E\u53D8\u91CF\u5F15\u7528\u3001\u8D44\u6E90\u6E05\u5355\u53CA\u622A\u56FE\u5173\u8054\u7684\u7ED3\u6784\u5316\u8BBE\u8BA1\u4E0A\u4E0B\u6587\uFF1B\u4E0D\u751F\u6210\u4E1A\u52A1\u4EE3\u7801\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        scope: { type: "string", enum: ["page", "node"] },
        include: array({ type: "string", enum: ["layout", "bounds", "text", "components", "variables", "styles", "assets"] }, { maxItems: 7 }),
        depth: integer(0, 6)
      }, TARGET_REQUIRED)
    },
    figma_list_pages: {
      name: "figma_list_pages",
      command: "listPages",
      classification: "read",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5217\u51FA\u5F53\u524D\u6587\u6863\u7684\u9875\u9762\uFF0C\u542B\u5F53\u524D\u9875\u6807\u8BC6\u4E0E\u9875\u9762\u4FEE\u8BA2\u3002",
      inputSchema: object(TARGET, TARGET_REQUIRED)
    },
    figma_manage_page: {
      name: "figma_manage_page",
      command: "managePage",
      classification: "context",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u521B\u5EFA\u3001\u91CD\u547D\u540D\u3001\u5220\u9664\u6216\u5207\u6362\u9875\u9762\uFF1B\u5207\u9875\u5355\u72EC\u5BF9\u8D26\uFF0C\u5B8C\u6210\u540E\u9700\u8BFB\u53D6\u65B0\u4E0A\u4E0B\u6587\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        action: { type: "string", enum: ["create", "rename", "delete", "switchPage"] },
        targetPageId: idStr(),
        pageName: str0(1e4),
        expectedPageName: str0(1e4),
        confirm: { type: "string", enum: ["DELETE"] }
      }, [...TARGET_REQUIRED, "operationId", "action"])
    },
    figma_get_screenshot: {
      name: "figma_get_screenshot",
      command: "getScreenshot",
      classification: "read",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5BFC\u51FA\u6307\u5B9A\u8282\u70B9\u7684 PNG \u622A\u56FE\uFF1B\u5C0F\u56FE\u5185\u8054\u8FD4\u56DE\uFF0C\u5927\u56FE\u81EA\u52A8\u843D\u672C\u673A\u4EA7\u7269\u5E76\u8FD4\u56DE\u53E5\u67C4\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        longEdge: integer(64, 8192),
        destination: { type: "string", enum: ["auto", "inline", "file"] }
      }, [...TARGET_REQUIRED, "nodeId"])
    },
    figma_export_asset: {
      name: "figma_export_asset",
      command: "exportAsset",
      classification: "file",
      editors: ["figma", "slides"],
      requiresTarget: true,
      description: "\u5BFC\u51FA\u8282\u70B9\u4E3A PNG/JPG/SVG/PDF\uFF0C\u5199\u5165\u914D\u7F6E\u7684\u4EA7\u7269\u76EE\u5F55\uFF1B\u8FD4\u56DE\u8DEF\u5F84\u3001\u5B57\u8282\u6570\u4E0E SHA-256\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        format: { type: "string", enum: ["PNG", "JPG", "SVG", "PDF"] },
        scale: number(0.01, 4),
        contentsOnly: bool,
        useAbsoluteBounds: bool,
        svgOutlineText: bool,
        svgIdAttribute: bool,
        svgSimplifyStroke: bool,
        destination: { type: "string", enum: ["file", "inline"] }
      }, [...TARGET_REQUIRED, "operationId", "nodeId", "format"])
    },
    figma_import_asset: {
      name: "figma_import_asset",
      command: "importAsset",
      classification: "file",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5BFC\u5165\u672C\u673A PNG/JPEG \u4E3A\u6301\u4E45\u56FE\u7247\u586B\u5145\uFF0CSVG \u4E3A\u53EF\u7F16\u8F91\u77E2\u91CF\u5E76\u653E\u7F6E\uFF1B\u4E0D\u63A5\u53D7 URL\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        filePath: str(4096),
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6),
        parentId: idStr(),
        name: str0(1e4)
      }, [...TARGET_REQUIRED, "operationId", "filePath"])
    },
    figma_read_asset: {
      name: "figma_read_asset",
      command: "readAsset",
      classification: "read",
      editors: ["figma", "figjam", "slides"],
      requiresTarget: false,
      description: "\u8BFB\u53D6\u672C\u673A\u4EA7\u7269\u7684\u5143\u6570\u636E\uFF08\u8DEF\u5F84\u3001\u5927\u5C0F\u3001SHA-256\u3001\u683C\u5F0F\uFF09\uFF1B\u5C0F\u578B\u8D44\u6E90\u53EF\u542B\u5185\u8054\u9884\u89C8\u3002",
      inputSchema: object({ artifactId: str(128) }, ["artifactId"])
    },
    figma_create_node: {
      name: "figma_create_node",
      command: "createNode",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5728\u5DF2\u786E\u8BA4\u9875\u9762\u521B\u5EFA\u8282\u70B9\uFF1BoperationId \u662F\u672C\u6B21\u5199\u5165\u7684\u552F\u4E00\u6807\u8BC6\uFF0C\u76F8\u540C ID \u4E0D\u91CD\u590D\u6267\u884C\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        type: { type: "string", enum: ["RECTANGLE", "ELLIPSE", "TEXT", "FRAME", "LINE", "STAR"] },
        parentId: idStr(),
        name: str0(1e4),
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6),
        width: number(0.01, 1e5),
        height: number(0, 1e5),
        text: str0(2e5),
        props: propsSchema
      }, [...TARGET_REQUIRED, "operationId", "type"])
    },
    figma_modify_node: {
      name: "figma_modify_node",
      command: "modifyNode",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u4FEE\u6539\u8282\u70B9\u767D\u540D\u5355\u5C5E\u6027\uFF1B\u987B\u63D0\u4F9B sessionId/pageId/pageRevision/operationId\u3002",
      inputSchema: object({ ...TARGET, operationId: operationIdSchema, nodeId: idStr(), props: propsSchema }, [...TARGET_REQUIRED, "operationId", "nodeId", "props"])
    },
    figma_delete_node: {
      name: "figma_delete_node",
      command: "deleteNode",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5220\u9664\u76EE\u6807\u8282\u70B9\uFF1B\u987B\u63D0\u4F9B operationId\u3002",
      inputSchema: object({ ...TARGET, operationId: operationIdSchema, nodeId: idStr() }, [...TARGET_REQUIRED, "operationId", "nodeId"])
    },
    figma_set_text: {
      name: "figma_set_text",
      command: "setText",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u4FEE\u6539\u6587\u672C\u8282\u70B9\uFF1B\u7701\u7565 text \u4FDD\u7559\u539F\u6587\uFF0C\u53EF\u5355\u72EC\u6539\u5B57\u4F53\u3001\u5B57\u53F7\u6216\u4F4D\u7F6E\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        text: str0(2e5),
        fontName: fontNameSchema,
        fontSize: number(1, 1e3),
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6)
      }, [...TARGET_REQUIRED, "operationId", "nodeId"])
    },
    figma_hierarchy: {
      name: "figma_hierarchy",
      command: "hierarchy",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5C42\u7EA7\u64CD\u4F5C\uFF1Aclone\u3001group\u3001ungroup\u3001reparent\u3001reorder\uFF1B\u533A\u5206\u7EDD\u5BF9\u4F4D\u7F6E\u4E0E\u5C40\u90E8\u5750\u6807\uFF0C\u62D2\u7EDD\u5FAA\u73AF\u5C42\u7EA7\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        action: { type: "string", enum: ["clone", "group", "ungroup", "reparent", "reorder"] },
        nodeId: idStr(),
        nodeIds: array(idStr(), { minItems: 1, maxItems: 100 }),
        parentId: idStr(),
        position: { type: "string", enum: ["keepAbsolute", "keepLocal"] },
        index: integer(0, 1e4),
        beforeNodeId: idStr(),
        name: str0(1e4)
      }, [...TARGET_REQUIRED, "operationId", "action"])
    },
    figma_vector: {
      name: "figma_vector",
      command: "vector",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u77E2\u91CF\u51E0\u4F55\uFF1A\u591A\u8FB9\u5F62\u3001\u77E2\u91CF\u8DEF\u5F84\u3001\u5E03\u5C14\u8FD0\u7B97\u4E0E\u5F62\u72B6\u53C2\u6570\uFF1B\u7ED3\u679C\u4E3A\u53EF\u7F16\u8F91\u8282\u70B9\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        action: { type: "string", enum: ["createPolygon", "createVectorPaths", "boolean", "setShapeParams", "setVectorNetwork"] },
        nodeId: idStr(),
        nodeIds: array(idStr(), { minItems: 2, maxItems: 2 }),
        operation: { type: "string", enum: ["UNION", "INTERSECT", "SUBTRACT", "EXCLUDE"] },
        parentId: idStr(),
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6),
        name: str0(1e4),
        pointCount: integer(3, 60),
        innerRadius: number(0, 1),
        cornerRadius: number(0, 1e5),
        polygonWidth: number(1, 1e5),
        polygonHeight: number(1, 1e5),
        vectorNetwork: object({}, [], true),
        paths: array(object({}, [], true), { maxItems: 64 })
      }, [...TARGET_REQUIRED, "operationId", "action"])
    },
    figma_layout: {
      name: "figma_layout",
      command: "layout",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "Auto Layout\u3001\u95F4\u8DDD\u3001\u5185\u8FB9\u8DDD\u3001\u5BF9\u9F50\u3001\u5C3A\u5BF8\u6A21\u5F0F\u4E0E\u7EA6\u675F\u7684\u8BBE\u7F6E\u4E0E\u79FB\u9664\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        childIds: array(idStr(), { maxItems: 100 }),
        action: { type: "string", enum: ["setLayout", "setChildLayout", "removeLayout", "setConstraints"] },
        props: object({
          layoutMode: { type: "string", enum: ["NONE", "HORIZONTAL", "VERTICAL"] },
          primaryAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "SPACE_BETWEEN"] },
          counterAxisAlignItems: { type: "string", enum: ["MIN", "CENTER", "MAX", "BASELINE"] },
          primaryAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"] },
          counterAxisSizingMode: { type: "string", enum: ["FIXED", "AUTO"] },
          itemSpacing: number(0, 1e5),
          counterAxisSpacing: number(0, 1e5),
          paddingLeft: number(0, 1e5),
          paddingRight: number(0, 1e5),
          paddingTop: number(0, 1e5),
          paddingBottom: number(0, 1e5),
          layoutWrap: { type: "string", enum: ["NO_WRAP", "WRAP"] },
          minWidth: number(0, 1e5),
          maxWidth: number(0, 1e5),
          minHeight: number(0, 1e5),
          maxHeight: number(0, 1e5),
          layoutAlign: { type: "string", enum: ["MIN", "CENTER", "MAX", "STRETCH", "INHERIT"] },
          layoutGrow: number(0, 1),
          layoutPositioning: { type: "string", enum: ["AUTO", "ABSOLUTE"] },
          layoutSizingHorizontal: { type: "string", enum: ["FIXED", "HUG", "FILL"] },
          layoutSizingVertical: { type: "string", enum: ["FIXED", "HUG", "FILL"] },
          horizontalConstraint: { type: "string", enum: ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"] },
          verticalConstraint: { type: "string", enum: ["MIN", "MAX", "CENTER", "STRETCH", "SCALE"] }
        })
      }, [...TARGET_REQUIRED, "operationId", "action"])
    },
    figma_text_range: {
      name: "figma_text_range",
      command: "textRange",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u8BFB\u53D6\u6216\u4FEE\u6539\u6587\u672C\u8282\u70B9\u7684\u5B57\u7B26\u533A\u95F4\u6837\u5F0F\uFF1BUTF-16 \u8FB9\u754C\u660E\u786E\uFF0C\u52A0\u8F7D\u5931\u8D25\u4E0D\u9759\u9ED8\u66FF\u6362\u5B57\u4F53\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        action: { type: "string", enum: ["getStyles", "setStyles"] },
        start: integer(0, 1e9),
        end: integer(0, 1e9),
        styles: object({
          fontName: fontNameSchema,
          fontSize: number(1, 1e3),
          lineHeight: { anyOf: [number(0, 1e5), object({ unit: { type: "string", enum: ["PIXELS", "PERCENT", "AUTO"] }, value: number(0, 1e5) }, ["unit", "value"])] },
          letterSpacing: { anyOf: [number(-1e5, 1e5), object({ unit: { type: "string", enum: ["PIXELS", "PERCENT"] }, value: number(-1e5, 1e5) }, ["unit", "value"])] },
          fills: paints,
          textCase: { type: "string", enum: ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"] },
          textDecoration: { type: "string", enum: ["NONE", "UNDERLINE", "STRIKETHROUGH"] }
        }),
        cursor: cursorSchema
      }, [...TARGET_REQUIRED, "nodeId", "action"])
    },
    figma_visual: {
      name: "figma_visual",
      command: "visual",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u89C6\u89C9\u5C5E\u6027\uFF1Aeffects\u3001\u6DF7\u5408\u3001\u5BB9\u5668\u88C1\u5207\u3001\u906E\u7F69\u3001\u7F51\u683C\u3001\u63CF\u8FB9\u7EC6\u8282\u4E0E\u5206\u89D2\u5706\u89D2\uFF1B\u6309\u8282\u70B9\u7C7B\u578B\u6821\u9A8C\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        action: { type: "string", enum: ["setEffects", "setBlend", "setClip", "setMask", "setGrids", "setStrokeDetail", "setCornerRadii"] },
        props: object({
          effects: array(object({}, [], true), { maxItems: 32 }),
          blendMode: str(64),
          clipsContent: bool,
          isMask: bool,
          maskType: { type: "string", enum: ["ALPHA", "LUMINANCE", "VECTOR"] },
          layoutGrids: array(object({}, [], true), { maxItems: 16 }),
          strokeAlign: { type: "string", enum: ["INSIDE", "OUTSIDE", "CENTER"] },
          strokeCap: { type: "string", enum: ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"] },
          strokeJoin: { type: "string", enum: ["MITER", "BEVEL", "ROUND"] },
          strokeMiterLimit: number(0, 1e3),
          dashPattern: array(number(0, 1e5), { maxItems: 32 }),
          strokeTopWeight: number(0, 1e5),
          strokeBottomWeight: number(0, 1e5),
          strokeLeftWeight: number(0, 1e5),
          strokeRightWeight: number(0, 1e5),
          topLeftRadius: number(0, 1e5),
          topRightRadius: number(0, 1e5),
          bottomLeftRadius: number(0, 1e5),
          bottomRightRadius: number(0, 1e5),
          cornerSmoothing: number(0, 1)
        })
      }, [...TARGET_REQUIRED, "operationId", "nodeId", "action"])
    },
    figma_variables: {
      name: "figma_variables",
      command: "variables",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u672C\u5730\u53D8\u91CF\u96C6\u5408\u3001\u53D8\u91CF\u3001\u6A21\u5F0F\u3001\u503C\u3001\u522B\u540D\u4E0E\u8282\u70B9\u7ED1\u5B9A\uFF1B\u5FAA\u73AF/\u7C7B\u578B\u51B2\u7A81\u8FD4\u56DE\u771F\u5B9E\u9519\u8BEF\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        action: { type: "string", enum: [
          "listCollections",
          "listVariables",
          "getVariable",
          "createCollection",
          "createVariable",
          "renameVariable",
          "deleteVariable",
          "setValue",
          "createMode",
          "renameMode",
          "deleteMode",
          "resolveValue",
          "setBoundVariable"
        ] },
        collectionId: idStr(),
        variableId: idStr(),
        modeId: idStr(),
        field: str(64),
        name: str0(512),
        resolvedType: { type: "string", enum: ["BOOLEAN", "FLOAT", "COLOR", "STRING"] },
        value: { anyOf: [number(-1e12, 1e12), bool, str0(4096), object({}, [], true)] },
        expectedCollectionName: str0(512)
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_styles: {
      name: "figma_styles",
      command: "styles",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u672C\u5730\u5171\u4EAB Paint/Text/Effect/Grid \u6837\u5F0F\u7684\u67E5\u8BE2\u3001\u521B\u5EFA\u3001\u4FEE\u6539\u4E0E\u5E94\u7528\uFF1B\u4E0D\u5305\u542B\u56E2\u961F\u5E93\u53D1\u5E03\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        action: { type: "string", enum: ["list", "get", "create", "update", "apply", "delete"] },
        styleType: { type: "string", enum: ["PAINT", "TEXT", "EFFECT", "GRID"] },
        styleId: idStr(),
        name: str0(512),
        props: object({
          paints,
          type: str(64),
          fontSize: number(1, 1e3),
          textDecoration: { type: "string", enum: ["NONE", "UNDERLINE", "STRIKETHROUGH"] },
          fontName: fontNameSchema,
          letterSpacing: number(-1e5, 1e5),
          lineHeight: number(0, 1e5),
          paragraphSpacing: number(0, 1e5),
          textCase: { type: "string", enum: ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"] },
          effects: array(object({}, [], true), { maxItems: 32 }),
          layoutGrids: array(object({}, [], true), { maxItems: 16 })
        })
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_components: {
      name: "figma_components",
      command: "components",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u7EC4\u4EF6/\u53D8\u4F53/\u5B9E\u4F8B\u7684\u521B\u5EFA\u3001\u5C5E\u6027\u3001\u5173\u8054\u3001\u4EA4\u6362\u3001\u5206\u79BB\u4E0E\u8BF4\u660E\uFF1B\u5B9E\u4F8B\u5F15\u7528\u4E0E\u8986\u76D6\u53EF\u6838\u9A8C\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        componentId: idStr(),
        instanceId: idStr(),
        action: { type: "string", enum: [
          "list",
          "createFromNode",
          "createInstance",
          "combineAsVariants",
          "swap",
          "detach",
          "getInstanceInfo",
          "setInstanceProperty",
          "addComponentProperty",
          "editComponentProperty",
          "deleteComponentProperty"
        ] },
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6),
        name: str0(512),
        parentId: idStr(),
        nodeIds: array(idStr(), { minItems: 2, maxItems: 64 }),
        propertyName: str0(512),
        propertyType: { type: "string", enum: ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"] },
        value: { anyOf: [bool, str0(4096), { type: "null" }] },
        defaultValue: { anyOf: [bool, str0(4096)] },
        variantOptions: array(str0(512), { maxItems: 64 }),
        description: str0(16384)
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_libraries: {
      name: "figma_libraries",
      command: "libraries",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u53D1\u73B0\u5F53\u524D\u6587\u4EF6\u5DF2\u542F\u7528\u5E93\u7684\u53D8\u91CF\u96C6\u5408/\u53D8\u91CF\uFF0C\u5E76\u6309\u5DF2\u77E5 key \u5BFC\u5165\u539F\u751F\u5141\u8BB8\u7684\u53D8\u91CF\u3001\u7EC4\u4EF6\u4E0E\u6837\u5F0F\u3002",
      inputSchema: object({
        ...TARGET,
        action: { type: "string", enum: ["listCollections", "listVariables", "importVariable", "importComponent", "importStyle"] },
        collectionKey: idStr(),
        variableKey: idStr(),
        componentKey: idStr(),
        styleKey: idStr()
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_set_reactions: {
      name: "figma_set_reactions",
      command: "setReactions",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u8BFB\u53D6\u3001\u8BBE\u7F6E\u6216\u6E05\u9664\u539F\u578B reactions\uFF1B\u5173\u952E\u5BFC\u822A\u4E0E\u8FD4\u56DE\u987B\u5B9E\u9645\u70B9\u51FB\u9A8C\u6536\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        action: { type: "string", enum: ["set", "clear"] },
        reactions: array(object({
          trigger: object({ type: { type: "string", enum: ["ON_CLICK", "ON_HOVER", "ON_PRESS", "ON_DRAG", "AFTER_TIMEOUT", "MOUSE_ENTER", "MOUSE_LEAVE", "MOUSE_UP", "MOUSE_DOWN"] }, timeout: number(0, 1e6) }, ["type"]),
          action: object({ type: { type: "string", enum: ["BACK", "CLOSE", "URL", "OPEN_LINK", "UPDATE_MEDIA_RUNTIME", "SET_VARIABLE", "SET_VARIABLE_MODE", "CONDITIONAL", "NODE"] }, destinationId: { anyOf: [idStr(), { type: "null" }] }, navigation: { type: "string", enum: ["NAVIGATE", "SWAP", "OVERLAY", "SCROLL_TO", "CHANGE_TO"] }, transition: { anyOf: [object({ type: { type: "string", enum: ["MOVE_IN", "MOVE_OUT", "PUSH", "SLIDE_IN", "SLIDE_OUT", "DISSOLVE", "SMART_ANIMATE", "SCROLL_ANIMATE"] }, duration: number(0, 1e4), easing: object({ type: { type: "string", enum: ["EASE_IN", "EASE_OUT", "EASE_IN_AND_OUT", "LINEAR"] } }, ["type"]) }, ["type"]), { type: "null" }] }, mediaAction: str(64), variableId: { anyOf: [idStr(), { type: "null" }] }, variableCollectionId: { anyOf: [idStr(), { type: "null" }] }, variableModeId: { anyOf: [idStr(), { type: "null" }] }, conditionalBlocks: array(object({}, [], true), { maxItems: 16 }), url: str(4096), preserveScrollPosition: bool, overlayRelativePosition: object({ x: number(-1e6, 1e6), y: number(-1e6, 1e6) }, ["x", "y"]) }, ["type"])
        }, ["trigger", "action"]), { maxItems: 64 }),
        prototypeStartNodeId: { anyOf: [idStr(), { type: "null" }] }
      }, [...TARGET_REQUIRED, "operationId", "nodeId", "action"])
    },
    figma_batch: {
      name: "figma_batch",
      command: "batch",
      classification: "write",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u987A\u5E8F\u6267\u884C\u6700\u591A 50 \u4E2A\u5DF2\u6CE8\u518C\u52A8\u4F5C\uFF0C\u53EF\u5F15\u7528\u524D\u5E8F\u7ED3\u679C\uFF1B\u5931\u8D25\u9ED8\u8BA4\u505C\u6B62\uFF0C\u8FD4\u56DE\u9010\u9879\u72B6\u6001\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        steps: array(object({ command: str(64), params: object({}, [], true) }, ["command", "params"]), { minItems: 1, maxItems: 50 }),
        continueOnError: bool
      }, [...TARGET_REQUIRED, "operationId", "steps"])
    },
    figma_motion: {
      name: "figma_motion",
      command: "motion",
      classification: "mixed",
      editors: ["figma"],
      requiresTarget: true,
      description: "Motion \u52A8\u753B\uFF1A\u6837\u5F0F\u53D1\u73B0\u3001\u8282\u70B9\u65F6\u95F4\u7EBF/\u8F68\u9053\u8BFB\u5199\u4E0E\u5173\u952E\u5E27\u8F68\u9053\u5E94\u7528\uFF1B\u4E0D\u751F\u6210\u4E1A\u52A1\u4EE3\u7801\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        action: { type: "string", enum: ["listAnimationStyles", "readNode", "applyStyle", "removeStyle", "applyTrack", "removeTrack", "setDuration"] },
        styleId: idStr(),
        duration: number(0, 1e6),
        field: object({ type: { type: "string", enum: ["PROPERTY", "PAINT", "EFFECT"] }, name: str(64), index: integer(0, 64) }, ["type", "name"]),
        track: object({ baseValue: object({}, [], true), keyframes: array(object({ timelinePosition: number(0, 1e6), value: object({}, [], true) }, ["timelinePosition", "value"]), { maxItems: 512 }) }, ["baseValue", "keyframes"])
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_export_video: {
      name: "figma_export_video",
      command: "exportVideo",
      classification: "job",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5BFC\u51FA\u5E26\u52A8\u753B\u7684\u9876\u5C42 Frame \u4E3A MP4\uFF0C\u5199\u5165\u4EA7\u7269\u76EE\u5F55\uFF1B\u8FD4\u56DE\u4F5C\u4E1A ID \u540E\u8F6E\u8BE2\u5BF9\u8D26\u3002",
      inputSchema: object({
        ...TARGET,
        operationId: operationIdSchema,
        nodeId: idStr(),
        format: { type: "string", enum: ["MP4"] },
        fps: { type: "integer", enum: [12, 24, 30, 60] },
        quality: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
        scale: { type: "number", enum: [0.5, 0.75, 1, 1.5, 2, 3, 4] },
        width: integer(1, 3840),
        height: integer(1, 3840)
      }, [...TARGET_REQUIRED, "operationId", "nodeId"])
    },
    figma_shaders: {
      name: "figma_shaders",
      command: "shaders",
      classification: "read",
      editors: ["figma"],
      requiresTarget: true,
      description: "\u5217\u51FA\u5F53\u524D\u6587\u4EF6\u53EF\u7528\u7684 Shader \u53CA\u5176\u53EF\u8BFB\u516C\u5F00\u914D\u7F6E\uFF1B\u4E0D\u5BFC\u5165\u3001\u4E0D\u5E94\u7528\u3001\u4E0D\u4FEE\u6539\u3002",
      inputSchema: object({ ...TARGET, cursor: cursorSchema }, TARGET_REQUIRED)
    },
    figma_figjam: {
      name: "figma_figjam",
      command: "figjam",
      classification: "mixed",
      editors: ["figjam"],
      requiresTarget: true,
      description: "\u5728\u5DF2\u6253\u5F00\u7684 FigJam \u4E2D\u521B\u5EFA/\u4FEE\u6539\u4FBF\u7B3A\u3001\u5E26\u6587\u5B57\u5F62\u72B6\u4E0E\u8FDE\u63A5\u7EBF\uFF0C\u5E76\u8BFB\u53D6\u539F\u751F\u53EF\u7F16\u8F91\u7ED3\u679C\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        action: { type: "string", enum: ["createSticky", "updateSticky", "createShapeWithText", "createConnector", "updateConnector", "listNodes"] },
        x: number(-1e6, 1e6),
        y: number(-1e6, 1e6),
        width: number(1, 1e5),
        height: number(1, 1e5),
        text: str0(2e5),
        name: str0(1e4),
        cursor: cursorSchema,
        limit: integer(1, 100),
        startNodeId: idStr(),
        endNodeId: idStr(),
        startMagnet: { type: "string", enum: ["AUTO", "TOP", "BOTTOM", "LEFT", "RIGHT", "CENTER"] },
        endMagnet: { type: "string", enum: ["AUTO", "TOP", "BOTTOM", "LEFT", "RIGHT", "CENTER"] },
        shapeType: { type: "string", enum: ["SQUARE", "ELLIPSE", "DIAMOND", "TRIANGLE_UP", "TRIANGLE_DOWN", "ROUNDED_RECTANGLE", "HEXAGON", "CLOUD", "PARALLELOGRAM_RIGHT", "PARALLELOGRAM_LEFT", "STAR", "SPEECH_BUBBLE", "PIE"] }
      }, [...TARGET_REQUIRED, "action"])
    },
    figma_slides: {
      name: "figma_slides",
      command: "slides",
      classification: "mixed",
      editors: ["slides"],
      requiresTarget: true,
      description: "\u5728\u5DF2\u6253\u5F00\u7684 Slides \u4E2D\u8BFB\u53D6\u7ED3\u6784\u5E76\u6309\u660E\u786E\u5185\u5BB9/\u4F4D\u7F6E\u521B\u5EFA\u4FEE\u6539\u5E7B\u706F\u7247\u4E0E\u53D7\u652F\u6301\u5185\u5BB9\u8282\u70B9\u3002",
      inputSchema: object({
        ...TARGET,
        nodeId: idStr(),
        slideId: idStr(),
        rowId: idStr(),
        action: { type: "string", enum: ["listStructure", "createSlide", "createSlideRow", "addContent", "updateContent"] },
        content: object({ type: { type: "string", enum: ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT", "LINE"] }, x: number(-1e6, 1e6), y: number(-1e6, 1e6), width: number(1, 1e5), height: number(1, 1e5), text: str0(2e5), name: str0(1e4), fontSize: number(1, 1e3), fills: paints }),
        order: { type: "string", enum: ["start", "end", "before", "after"] },
        relativeToId: idStr()
      }, [...TARGET_REQUIRED, "action"])
    }
  };
  var WRITE_ACTIONS_BY_COMMAND = {
    variables: ["createCollection", "createVariable", "renameVariable", "deleteVariable", "setValue", "createMode", "renameMode", "deleteMode", "setBoundVariable"],
    styles: ["create", "update", "apply", "delete"],
    components: ["createFromNode", "createInstance", "combineAsVariants", "swap", "detach", "setInstanceProperty", "addComponentProperty", "editComponentProperty", "deleteComponentProperty"],
    libraries: ["importVariable", "importComponent", "importStyle"],
    textRange: ["setStyles"],
    motion: ["applyStyle", "removeStyle", "applyTrack", "removeTrack", "setDuration"],
    figjam: ["createSticky", "updateSticky", "createShapeWithText", "createConnector", "updateConnector"],
    slides: ["createSlide", "createSlideRow", "addContent", "updateContent"]
  };
  for (const tool of Object.values(R)) {
    if (tool.classification !== "mixed") continue;
    const actions = WRITE_ACTIONS_BY_COMMAND[tool.command] || [];
    if (actions.length === 0) continue;
    tool.inputSchema.properties.operationId = operationIdSchema;
    tool.inputSchema.allOf = [{
      if: { properties: { action: { enum: actions } } },
      then: { required: ["operationId"] }
    }];
  }
  R.figma_create_node.inputSchema.allOf = [
    { if: { properties: { type: { const: "TEXT" } } }, then: { required: ["text"] } },
    { if: { properties: { type: { const: "LINE" } } }, else: { properties: { height: { minimum: 0.01 } } } }
  ];
  var TOOLS = R;
  var COMMANDS = new Map(Object.values(TOOLS).filter((t) => t.command).map((t) => [t.command, t]));
  var WRITE_COMMANDS = new Set(Object.values(TOOLS).filter((t) => ["write", "file", "job", "context"].includes(t.classification)).map((t) => t.command));
  function isWriteCall(command, params) {
    const tool = COMMANDS.get(command);
    if (!tool) return false;
    if (["write", "file", "job", "context"].includes(tool.classification)) return true;
    if (tool.classification !== "mixed") return false;
    const set = WRITE_ACTIONS_BY_COMMAND[command];
    return !!set && !!params && set.includes(params.action);
  }

  // shared/schema-validator.js
  var own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
  var isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  var SchemaError = class extends Error {
    constructor(message, path = "arguments") {
      super(message);
      this.name = "SchemaError";
      this.code = "INVALID_PARAM";
      this.path = path;
    }
  };
  function fail(label, detail) {
    throw new SchemaError(`${label} ${detail}`, label);
  }
  function validateSchema(value, schema, label = "arguments") {
    validateValue(value, schema, label);
    return value;
  }
  function validateValue(value, schema, label) {
    if (!schema || typeof schema !== "object") return;
    if (Array.isArray(schema.anyOf)) {
      const errors = [];
      for (const candidate of schema.anyOf) {
        try {
          validateValue(value, candidate, label);
          return;
        } catch (e) {
          errors.push(e.message);
        }
      }
      fail(label, `\u4E0D\u5339\u914D anyOf \u7684\u4EFB\u4F55\u5206\u652F: ${errors[0] || "\u672A\u77E5\u539F\u56E0"}`);
    }
    if (Array.isArray(schema.allOf)) {
      for (const sub of schema.allOf) validateValue(value, sub, label);
    }
    if (schema.if !== void 0) {
      let applies = true;
      try {
        validateValue(value, schema.if, label);
      } catch {
        applies = false;
      }
      if (applies) {
        if (schema.then !== void 0) validateValue(value, schema.then, label);
      } else if (schema.else !== void 0) {
        validateValue(value, schema.else, label);
      }
    }
    if (schema.const !== void 0 && !deepEqual(value, schema.const)) {
      fail(label, `\u5FC5\u987B\u7B49\u4E8E ${JSON.stringify(schema.const)}`);
    }
    if (schema.enum !== void 0 && !schema.enum.some((candidate) => deepEqual(value, candidate))) {
      fail(label, "\u4E0D\u5728\u5141\u8BB8\u503C\u4E2D");
    }
    if (schema.type !== void 0) {
      const ok = schema.type === "object" ? isPlainObject(value) : schema.type === "array" ? Array.isArray(value) : schema.type === "null" ? value === null : schema.type === "integer" ? Number.isSafeInteger(value) : schema.type === "number" ? typeof value === "number" && Number.isFinite(value) : schema.type === "boolean" ? typeof value === "boolean" : typeof value === schema.type;
      if (!ok) fail(label, `\u5FC5\u987B\u662F ${schema.type}`);
    }
    if (typeof value === "string") {
      if (schema.minLength !== void 0 && value.length < schema.minLength) fail(label, "\u957F\u5EA6\u4E0D\u5408\u6CD5");
      if (schema.maxLength !== void 0 && value.length > schema.maxLength) fail(label, "\u957F\u5EA6\u4E0D\u5408\u6CD5");
      if (schema.pattern !== void 0 && !new RegExp(schema.pattern).test(value)) fail(label, "\u683C\u5F0F\u4E0D\u5408\u6CD5");
    }
    if (typeof value === "number") {
      if (schema.minimum !== void 0 && value < schema.minimum) fail(label, "\u8D85\u51FA\u8303\u56F4");
      if (schema.maximum !== void 0 && value > schema.maximum) fail(label, "\u8D85\u51FA\u8303\u56F4");
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== void 0 && value.length < schema.minItems) fail(label, "\u6570\u91CF\u4E0D\u5408\u6CD5");
      if (schema.maxItems !== void 0 && value.length > schema.maxItems) fail(label, "\u6570\u91CF\u4E0D\u5408\u6CD5");
      if (schema.items !== void 0) value.forEach((item, i) => validateValue(item, schema.items, `${label}[${i}]`));
    }
    if (isPlainObject(value) && isPlainObject(schema.properties)) {
      for (const key of schema.required || []) if (!own(value, key)) fail(label, `\u7F3A\u5C11 ${key}`);
      for (const key of Object.keys(value)) {
        if (!own(schema.properties, key)) {
          if (schema.additionalProperties !== false) continue;
          fail(label, `\u542B\u672A\u77E5\u5B57\u6BB5: ${key}`);
        }
        validateValue(value[key], schema.properties[key], `${label}.${key}`);
      }
    }
  }
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (a === null || b === null) return false;
    if (typeof a !== "object") return false;
    const aIsArray = Array.isArray(a);
    const bIsArray = Array.isArray(b);
    if (aIsArray !== bIsArray) return false;
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) if (!deepEqual(a[key], b[key])) return false;
    return true;
  }

  // plugin/src/util.js
  function isPlainObject2(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  }
  function hasOwn(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function appErr(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
  }
  function isFiniteNum(v, min, max) {
    return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
  }
  function requireStr(v, name, opts = {}) {
    if (typeof v !== "string" || !opts.allowEmpty && !v.length) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
    return v;
  }
  function requireNum(v, name, min, max) {
    if (!isFiniteNum(v, min, max)) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u5728 [${min}, ${max}] \u5185`);
    return v;
  }
  function requireBool(v, name) {
    if (typeof v !== "boolean") throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
    return v;
  }
  function onlyKeys(p, keys) {
    if (!isPlainObject2(p)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    for (const k of Object.keys(p)) if (!keys.includes(k)) throw appErr("INVALID_PARAM", `\u672A\u77E5\u53C2\u6570: ${k}`);
  }
  function cloneValue(v) {
    if (v === figma.mixed) return { mixed: true };
    if (typeof v === "number" && !Number.isFinite(v)) return null;
    if (v === void 0) return void 0;
    return JSON.parse(JSON.stringify(v));
  }
  function pageOfNode(node) {
    let n = node;
    while (n && n.type !== "PAGE" && n.type !== "DOCUMENT") n = n.parent;
    return n && n.type === "PAGE" ? n : null;
  }
  function buildNodeInfo(node, depth = 0, budget = { remaining: 100, remainingChars: 56e3 }, fields = null) {
    budget.remaining--;
    const name = String(node.name);
    const info = { id: node.id, name: name.slice(0, 1024), type: node.type, parentId: node.parent ? node.parent.id : null };
    if (name.length > 1024) {
      info.nameTruncated = true;
      info.nameLength = name.length;
    }
    const errors = [];
    const truncatedFields = [];
    budget.remainingChars -= JSON.stringify(info).length + 256;
    const wanted = fields || [
      "x",
      "y",
      "width",
      "height",
      "rotation",
      "opacity",
      "visible",
      "locked",
      "fills",
      "strokes",
      "strokeWeight",
      "cornerRadius",
      "fontName",
      "fontSize",
      "characters"
    ];
    for (const k of wanted) {
      if (!(k in node)) continue;
      try {
        let v = cloneValue(node[k]);
        if (k === "characters" && typeof v === "string" && v.length > 16e3) {
          info.charactersLength = v.length;
          info.charactersTruncated = true;
          v = v.slice(0, 16e3);
        }
        if (v !== void 0) {
          const size = JSON.stringify(v).length;
          if (size > 24e3 || size > budget.remainingChars) {
            truncatedFields.push(k);
            continue;
          }
          budget.remainingChars -= size + k.length + 4;
          info[k] = v;
        }
      } catch (e) {
        errors.push(k);
      }
    }
    const children = node.children || [];
    info.childrenCount = children.length;
    if (depth > 0 && children.length) {
      info.children = [];
      for (const child of children) {
        if (budget.remaining <= 0 || budget.remainingChars < 2e3) break;
        info.children.push(buildNodeInfo(child, depth - 1, budget, fields));
      }
    }
    info.truncated = children.length > (info.children || []).length || !!(info.children || []).find((n) => n.truncated);
    if (errors.length) info.readErrors = errors;
    if (truncatedFields.length) {
      info.truncatedFields = truncatedFields;
      info.truncated = true;
    }
    return info;
  }
  function paginate(nodes, p, getContext2) {
    onlyKeys(p, ["cursor", "limit"]);
    const limit = p.limit === void 0 ? 50 : requireNum(p.limit, "limit", 1, 100);
    if (!Number.isInteger(limit)) throw appErr("INVALID_PARAM", "limit \u5FC5\u987B\u662F\u6574\u6570");
    if (p.cursor !== void 0 && (typeof p.cursor !== "string" || !/^(0|[1-9][0-9]*)$/.test(p.cursor))) throw appErr("INVALID_PARAM", "cursor \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\u7684\u5B57\u7B26\u4E32");
    const offset = p.cursor === void 0 ? 0 : Number(p.cursor);
    if (!Number.isSafeInteger(offset) || offset > nodes.length) throw appErr("INVALID_PARAM", "cursor \u8D85\u51FA\u8303\u56F4\uFF0C\u8BF7\u91CD\u65B0\u4ECE\u9996\u9875\u8BFB\u53D6");
    const budget = { remaining: 100, remainingChars: 56e3 };
    const selected = [];
    for (const n of nodes.slice(offset, offset + limit)) {
      if (budget.remainingChars < 18e3 && selected.length) break;
      selected.push(buildNodeInfo(n, 0, budget));
    }
    const next = offset + selected.length;
    return {
      ...getContext2(),
      nodes: selected,
      total: nodes.length,
      nextCursor: next < nodes.length ? String(next) : null,
      truncated: next < nodes.length
    };
  }
  function hexToRgb01(hex) {
    if (typeof hex !== "string") throw appErr("INVALID_PARAM", "color \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6216 {r,g,b} \u5BF9\u8C61");
    const m = hex.trim().match(/^#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/);
    if (!m) throw appErr("INVALID_PARAM", `\u975E\u6CD5 hex \u989C\u8272: ${hex}\uFF08\u9700 #RRGGBB \u6216 #RGB\uFF09`);
    let h = m[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 };
  }
  var PAINT_TYPES = /* @__PURE__ */ new Set([
    "SOLID",
    "GRADIENT_LINEAR",
    "GRADIENT_RADIAL",
    "GRADIENT_ANGULAR",
    "GRADIENT_DIAMOND",
    "IMAGE",
    "VIDEO",
    "EMOJI",
    "SHADER"
  ]);
  function validatePaints(v, name) {
    if (!Array.isArray(v)) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u6570\u7EC4`);
    if (v.length > 32) throw appErr("INVALID_PARAM", `${name} \u6570\u91CF\u8D85\u8FC7 32`);
    const out = [];
    for (const paint2 of v) {
      if (!isPlainObject2(paint2)) throw appErr("INVALID_PARAM", `${name} \u5143\u7D20\u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61`);
      if (typeof paint2.type !== "string" || !PAINT_TYPES.has(paint2.type)) {
        throw appErr("INVALID_PARAM", `${name} \u5143\u7D20 type \u975E\u6CD5`);
      }
      if (paint2.type === "SOLID") {
        let c = paint2.color;
        if (typeof c === "string") c = hexToRgb01(c);
        if (!isPlainObject2(c)) throw appErr("INVALID_PARAM", "SOLID \u586B\u5145\u9700\u8981 color");
        for (const ch of ["r", "g", "b"]) {
          if (!isFiniteNum(c[ch], 0, 1)) throw appErr("INVALID_PARAM", `color.${ch} \u9700\u5728 [0,1]`);
        }
        if (c.a !== void 0 && !isFiniteNum(c.a, 0, 1)) throw appErr("INVALID_PARAM", "color.a \u9700\u5728 [0,1]");
        if (c.a !== void 0 && paint2.opacity !== void 0 && c.a !== paint2.opacity) {
          throw appErr("INVALID_PARAM", "color.a \u4E0E opacity \u51B2\u7A81");
        }
        const normalized = { type: "SOLID", color: { r: c.r, g: c.g, b: c.b } };
        const opacity = paint2.opacity === void 0 ? c.a : paint2.opacity;
        if (opacity !== void 0) normalized.opacity = requireNum(opacity, "opacity", 0, 1);
        if (paint2.visible !== void 0) normalized.visible = requireBool(paint2.visible, "visible");
        if (paint2.blendMode !== void 0) normalized.blendMode = requireStr(paint2.blendMode, "blendMode");
        if (paint2.boundVariables !== void 0) normalized.boundVariables = JSON.parse(JSON.stringify(paint2.boundVariables));
        const allowed = /* @__PURE__ */ new Set(["type", "color", "opacity", "visible", "blendMode", "boundVariables"]);
        for (const key of Object.keys(paint2)) if (!allowed.has(key)) throw appErr("INVALID_PARAM", `\u4E0D\u652F\u6301 SOLID.${key}`);
        for (const key of Object.keys(c)) if (!["r", "g", "b", "a"].includes(key)) throw appErr("INVALID_PARAM", `\u4E0D\u652F\u6301 color.${key}`);
        out.push(normalized);
      } else {
        out.push(JSON.parse(JSON.stringify(paint2)));
      }
    }
    return out;
  }
  function utf16SafeBoundary(text, index) {
    if (index <= 0 || index >= text.length) return index;
    const code = text.charCodeAt(index - 1);
    const next = text.charCodeAt(index);
    if (code >= 55296 && code <= 56319 && next >= 56320 && next <= 57343) return index - 1;
    return index;
  }
  function summarizeText(text, maxChars = 64) {
    if (typeof text !== "string") return null;
    if (text.length <= maxChars * 2) return text;
    return { length: text.length, head: text.slice(0, maxChars), tail: text.slice(-maxChars) };
  }
  function simpleTextDigest(text) {
    if (typeof text !== "string") return null;
    let hash = 5381;
    for (let i = 0; i < text.length; i++) hash = (hash << 5) + hash + text.charCodeAt(i) >>> 0;
    return [
      text.length,
      hash.toString(36),
      text.slice(0, 64),
      text.slice(-64)
    ].join("|");
  }

  // plugin/src/context.js
  var state = {
    sessionId: newSessionId(),
    runId: newSessionId(),
    pageRevision: 0
  };
  function newSessionId() {
    return Date.now().toString(36) + "-" + Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join("");
  }
  function rotateSession() {
    state.sessionId = newSessionId();
    state.pageRevision++;
    return state.sessionId;
  }
  function bumpPageRevision() {
    state.pageRevision++;
    return state.pageRevision;
  }
  function getContext() {
    const pageName = String(figma.currentPage.name);
    const fileName = String(figma.root.name);
    const context = {
      sessionId: state.sessionId,
      runId: state.runId,
      pageId: figma.currentPage.id,
      pageName: pageName.slice(0, 256),
      fileName: fileName.slice(0, 256),
      editorType: figma.editorType,
      pageRevision: state.pageRevision,
      ...pageName.length > 256 ? { pageNameTruncated: true } : {},
      ...fileName.length > 256 ? { fileNameTruncated: true } : {}
    };
    if (figma.fileKey !== void 0 && figma.fileKey !== null && typeof figma.fileKey === "string") {
      context.fileKey = figma.fileKey;
    }
    return context;
  }
  function assertTarget(t) {
    if (t.sessionId !== state.sessionId) throw appErr("SESSION_CHANGED", "\u63D2\u4EF6\u6388\u6743\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001");
    if (t.pageId !== figma.currentPage.id) throw appErr("PAGE_CHANGED", "\u76EE\u6807\u9875\u9762\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001");
    if (t.revision !== state.pageRevision) throw appErr("PAGE_CHANGED", "\u9875\u9762\u4FEE\u8BA2\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001");
    if (t.runId !== state.runId) throw appErr("RUN_CHANGED", "\u63D2\u4EF6\u8FD0\u884C\u5B9E\u4F8B\u5DF2\u53D8\u5316");
  }
  function assertAuthGeneration(t) {
    if (t.sessionId !== state.sessionId) throw appErr("SESSION_CHANGED", "\u63D2\u4EF6\u6388\u6743\u4F1A\u8BDD\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u8BFB\u53D6\u72B6\u6001");
    if (t.runId !== state.runId) throw appErr("RUN_CHANGED", "\u63D2\u4EF6\u8FD0\u884C\u5B9E\u4F8B\u5DF2\u53D8\u5316");
  }
  function makeTarget(msg) {
    return {
      sessionId: msg.sessionId,
      pageId: msg.pageId,
      runId: msg.runId || state.runId,
      revision: Number.isSafeInteger(msg.pageRevision) ? msg.pageRevision : state.pageRevision,
      mutating: false,
      affected: []
    };
  }
  async function getNode(id, t, { allowContainer = false } = {}) {
    requireStr(id, "id");
    const node = await figma.getNodeByIdAsync(id);
    assertTarget(t);
    if (!node || node.removed) throw appErr("NODE_NOT_FOUND", `\u627E\u4E0D\u5230\u8282\u70B9: ${id}`);
    if (!allowContainer && (node.type === "DOCUMENT" || node.type === "PAGE")) throw appErr("INVALID_TARGET", "\u8BF7\u4F7F\u7528\u9875\u9762\u4E0A\u4E0B\u6587\u63A5\u53E3\u8BFB\u53D6\u9875\u9762");
    if (!pageOfNode(node) || pageOfNode(node).id !== t.pageId) throw appErr("PAGE_CHANGED", "\u8282\u70B9\u4E0D\u5728\u5F53\u524D\u6388\u6743\u9875\u9762");
    return node;
  }
  function markMutation(t, node) {
    assertTarget(t);
    if (node && (node.removed || !pageOfNode(node) || pageOfNode(node).id !== t.pageId)) throw appErr("PAGE_CHANGED", "\u8282\u70B9\u5DF2\u79FB\u51FA\u5F53\u524D\u6388\u6743\u9875\u9762\u6216\u88AB\u79FB\u9664");
    t.mutating = true;
    if (node && !t.affected.includes(node.id)) t.affected.push(node.id);
  }

  // shared/limits.js
  var LIMITS = {
    FRAME_BYTES: 256 * 1024,
    STDIO_BYTES: 1024 * 1024,
    CHUNK_RAW_BYTES: 64 * 1024,
    RESOURCE_BYTES: 16 * 1024 * 1024,
    CONCURRENT_TRANSFERS: 2,
    UNACKED_CHUNKS: 4,
    STAGING_BYTES: 64 * 1024 * 1024,
    TRANSFER_IDLE_MS: 3e4,
    TRANSFER_TOTAL_MS: 12e4,
    BITMAP_PIXELS: 16777216,
    PREVIEW_LONG_EDGE: 1600,
    PREVIEW_LONG_EDGE_MAX: 8192,
    QUERY_PAGE_IDS: 100,
    ACTIVE_HANDLES: 16,
    HANDLE_MEMBER_IDS: 1e4,
    HANDLE_BUDGET_BYTES: 8 * 1024 * 1024,
    HANDLE_TTL_MS: 12e4,
    BATCH_STEPS: 50,
    OPERATION_RECORDS: 1e3,
    OPERATION_RECORD_BYTES: 8 * 1024 * 1024,
    PENDING_REQUESTS: 100,
    PENDING_CONTROL_RESERVED: 8,
    INLINE_PREVIEW_BYTES: 128 * 1024,
    TEXT_CHUNK_CHARS: 16e3
  };
  var BATCH_EXCLUDED_COMMANDS = /* @__PURE__ */ new Set([
    "managePage",
    "exportAsset",
    "importAsset",
    "exportVideo",
    "batch",
    "getOperation",
    "getCapabilities"
  ]);

  // plugin/src/records.js
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map((v) => v === void 0 ? "null" : canonical(v)).join(",") + "]";
    if (isPlainObject2(value)) return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}";
    return JSON.stringify(value);
  }
  var operations = /* @__PURE__ */ new Map();
  var operationBytes = 0;
  function operationCapacity(reserve) {
    if (operations.size >= LIMITS.OPERATION_RECORDS || operationBytes + reserve > LIMITS.OPERATION_RECORD_BYTES) {
      throw appErr("OPERATION_CAPACITY", "\u672C\u6B21\u63D2\u4EF6\u8FD0\u884C\u64CD\u4F5C\u8BB0\u5F55\u5DF2\u6EE1\uFF1B\u5BF9\u8D26\u540E\u91CD\u5F00\u63D2\u4EF6\uFF0C\u4E0D\u4F1A\u9010\u51FA\u65E7\u8BB0\u5F55\u518D\u91CD\u590D\u6267\u884C");
    }
  }
  function operationBudgetAvailable() {
    return operationBytes + 196608 <= LIMITS.OPERATION_RECORD_BYTES;
  }
  function reserveOperation(id, meta) {
    operationBytes += meta.reserve;
    operations.set(id, meta);
  }
  function addOperationBytes(delta) {
    operationBytes += delta;
  }
  function getOperation(id) {
    return operations.get(id);
  }
  function operationRecordKey(id, sessionId, pageId, command, params) {
    return canonical({ sessionId, pageId, command, params });
  }
  var cursors = /* @__PURE__ */ new Map();
  var cursorSerialBytes = 0;
  function createCursor(kind, meta) {
    pruneCursors();
    const serialized = JSON.stringify(meta);
    if (cursors.size >= LIMITS.ACTIVE_HANDLES) throw appErr("HANDLE_CAPACITY", "\u6D3B\u52A8\u8BFB\u53D6\u53E5\u67C4\u8FC7\u591A\uFF0C\u8BF7\u7EE7\u7EED\u6D88\u8D39\u6216\u7B49\u5F85\u8FC7\u671F");
    cursorSerialBytes += serialized.length;
    if (cursorSerialBytes > LIMITS.HANDLE_BUDGET_BYTES) {
      cursorSerialBytes -= serialized.length;
      throw appErr("HANDLE_CAPACITY", "\u8BFB\u53D6\u53E5\u67C4\u9884\u7B97\u8017\u5C3D");
    }
    const cursorId = "h_" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
    cursors.set(cursorId, {
      kind,
      createdAt: Date.now(),
      expiresAt: Date.now() + LIMITS.HANDLE_TTL_MS,
      meta,
      serializedBytes: serialized.length,
      runId: getContext().runId,
      sessionId: getContext().sessionId,
      pageId: getContext().pageId
    });
    return cursorId;
  }
  function readCursor(cursorId, msg) {
    const c = cursors.get(cursorId);
    if (!c) throw appErr("CURSOR_NOT_FOUND", "\u8BFB\u53D6\u53E5\u67C4\u4E0D\u5B58\u5728\u6216\u5DF2\u8FC7\u671F");
    const current = getContext();
    if (c.runId !== current.runId || c.sessionId !== current.sessionId || c.pageId !== current.pageId) {
      throw appErr("CURSOR_STALE", "\u8BFB\u53D6\u53E5\u67C4\u4E0D\u5C5E\u4E8E\u5F53\u524D\u4F1A\u8BDD/\u9875\u9762");
    }
    if (Date.now() > c.expiresAt) {
      dropCursor(cursorId);
      throw appErr("CURSOR_EXPIRED", "\u8BFB\u53D6\u53E5\u67C4\u5DF2\u8FC7\u671F");
    }
    return c;
  }
  function touchCursor(cursorId) {
    const c = cursors.get(cursorId);
    if (c) c.expiresAt = Date.now() + LIMITS.HANDLE_TTL_MS;
    return c;
  }
  function dropCursor(cursorId) {
    const c = cursors.get(cursorId);
    if (c) {
      cursorSerialBytes -= c.serializedBytes || 0;
      cursors.delete(cursorId);
    }
  }
  function pruneCursors() {
    const now = Date.now();
    for (const [id, c] of cursors) if (now > c.expiresAt) dropCursor(id);
  }
  function clearAllRecords() {
    for (const id of [...operations.keys()]) operations.delete(id);
    operationBytes = 0;
    for (const id of [...cursors.keys()]) dropCursor(id);
    cursorSerialBytes = 0;
    for (const id of [...jobs.keys()]) jobs.delete(id);
  }
  var jobs = /* @__PURE__ */ new Map();
  function createJob(operationId, meta) {
    const job = { operationId, state: "accepted", result: null, ...meta };
    jobs.set(operationId, job);
    return job;
  }
  function getJob(operationId) {
    return jobs.get(operationId);
  }
  function updateJob(operationId, patch) {
    const job = jobs.get(operationId);
    if (!job) return null;
    Object.assign(job, patch);
    return job;
  }

  // plugin/src/read.js
  var handlers = {
    async getContext(p, t) {
      return paginate(figma.currentPage.children, p, getContext);
    },
    async getSelection(p, t) {
      return paginate(figma.currentPage.selection || [], p, getContext);
    },
    async getNodeInfo(p, t) {
      onlyKeys(p, ["id", "depth"]);
      const depth = p.depth === void 0 ? 3 : requireNum(p.depth, "depth", 0, 6);
      if (!Number.isInteger(depth)) throw appErr("INVALID_PARAM", "depth \u5FC5\u987B\u662F\u6574\u6570");
      return buildNodeInfo(await getNode(p.id, t), depth);
    }
  };

  // plugin/src/edit.js
  var CREATE_TYPES = ["RECTANGLE", "ELLIPSE", "TEXT", "FRAME", "LINE", "STAR"];
  var MODIFY_PROPS = /* @__PURE__ */ new Set([
    "name",
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "opacity",
    "visible",
    "fills",
    "strokes",
    "strokeWeight",
    "cornerRadius"
  ]);
  function validateModifyProps(props) {
    if (!isPlainObject2(props)) throw appErr("INVALID_PARAM", "props \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    const out = {};
    for (const key of Object.keys(props)) {
      if (!MODIFY_PROPS.has(key)) throw appErr("INVALID_PARAM", `\u5C5E\u6027\u4E0D\u5728\u767D\u540D\u5355\u5185: ${key}`);
      const v = props[key];
      switch (key) {
        case "name":
          out.name = requireStr(v, "name", { allowEmpty: true });
          break;
        case "x":
          out.x = requireNum(v, "x", -1e6, 1e6);
          break;
        case "y":
          out.y = requireNum(v, "y", -1e6, 1e6);
          break;
        case "width":
          out.width = requireNum(v, "width", 0.01, 1e5);
          break;
        case "height":
          out.height = requireNum(v, "height", 0, 1e5);
          break;
        case "rotation":
          out.rotation = requireNum(v, "rotation", -360, 360);
          break;
        case "opacity":
          out.opacity = requireNum(v, "opacity", 0, 1);
          break;
        case "visible":
          out.visible = requireBool(v, "visible");
          break;
        case "strokeWeight":
          out.strokeWeight = requireNum(v, "strokeWeight", 0, 1e5);
          break;
        case "cornerRadius":
          out.cornerRadius = requireNum(v, "cornerRadius", 0, 1e5);
          break;
        case "fills":
          out.fills = validatePaints(v, "fills");
          break;
        case "strokes":
          out.strokes = validatePaints(v, "strokes");
          break;
      }
    }
    return out;
  }
  async function loadFont(font) {
    try {
      await figma.loadFontAsync(font);
    } catch (e) {
      throw appErr("FONT_NOT_LOADABLE", `\u65E0\u6CD5\u52A0\u8F7D\u5B57\u4F53 ${font.family} ${font.style}`);
    }
  }
  async function loadNodeFonts(node, extra) {
    let fonts = [];
    if (extra) fonts = [extra];
    else if (node.characters.length) fonts = node.getRangeAllFontNames(0, node.characters.length);
    else if (node.fontName !== figma.mixed) fonts = [node.fontName];
    const seen = /* @__PURE__ */ new Set();
    for (const f of fonts) {
      const key = JSON.stringify(f);
      if (!seen.has(key)) {
        seen.add(key);
        await loadFont(f);
      }
    }
  }
  function preflightProps(node, props) {
    for (const k of Object.keys(props)) {
      if (!(k in node)) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 ${k}`);
    }
    if (hasOwn(props, "width") || hasOwn(props, "height")) {
      if (typeof node.resize !== "function") throw appErr("UNSUPPORTED_PROPERTY", "\u8282\u70B9\u4E0D\u80FD\u8C03\u6574\u5C3A\u5BF8");
      const w = hasOwn(props, "width") ? props.width : node.width;
      const h = hasOwn(props, "height") ? props.height : node.height;
      requireNum(w, "width", 0.01, 1e5);
      if (node.type === "LINE") {
        if (h !== 0) throw appErr("INVALID_PARAM", "LINE \u7684 height \u5FC5\u987B\u4E3A 0");
      } else requireNum(h, "height", 0.01, 1e5);
    }
  }
  function applyProps(node, props, t) {
    preflightProps(node, props);
    const applied = [];
    try {
      for (const k of Object.keys(props)) {
        if (k === "width" || k === "height") continue;
        markMutation(t, node);
        node[k] = props[k];
        applied.push(k);
      }
      if (hasOwn(props, "width") || hasOwn(props, "height")) {
        markMutation(t, node);
        node.resize(
          hasOwn(props, "width") ? props.width : node.width,
          node.type === "LINE" ? 0 : hasOwn(props, "height") ? props.height : node.height
        );
        applied.push("size");
      }
    } catch (e) {
      const failure2 = appErr("PROP_APPLY_FAILED", e.message);
      failure2.state = t.mutating ? "partial" : "not_started";
      failure2.details = { appliedProperties: applied };
      if (t.mutating && !node.removed && pageOfNode(node) && pageOfNode(node).id === t.pageId) failure2.details.readBack = buildNodeInfo(node);
      throw failure2;
    }
  }
  async function handleCreateNode(p, t) {
    onlyKeys(p, ["type", "name", "x", "y", "width", "height", "parentId", "text", "props"]);
    if (!CREATE_TYPES.includes(p.type)) throw appErr("INVALID_PARAM", "\u4E0D\u652F\u6301\u521B\u5EFA\u8BE5\u7C7B\u578B");
    const props = p.props === void 0 ? {} : validateModifyProps(p.props);
    for (const k of ["name", "x", "y", "width", "height"]) {
      if (hasOwn(p, k)) {
        if (hasOwn(props, k)) throw appErr("INVALID_PARAM", `\u91CD\u590D\u6307\u5B9A\u5C5E\u6027 ${k}`);
        Object.assign(props, validateModifyProps({ [k]: p[k] }));
      }
    }
    if (p.type === "TEXT") requireStr(p.text, "text", { allowEmpty: true });
    else if (p.text !== void 0) throw appErr("INVALID_PARAM", "text \u53EA\u7528\u4E8E TEXT");
    if (hasOwn(props, "height")) {
      if (p.type === "LINE" && props.height !== 0) throw appErr("INVALID_PARAM", "LINE \u7684 height \u5FC5\u987B\u4E3A 0");
      if (p.type !== "LINE") requireNum(props.height, "height", 0.01, 1e5);
    }
    const parent = p.parentId === void 0 ? null : await getNode(p.parentId, t);
    if (parent && parent.type !== "FRAME") throw appErr("INVALID_TARGET", "parentId \u5FC5\u987B\u662F\u5F53\u524D\u9875 FRAME");
    const font = { family: "Inter", style: "Regular" };
    if (p.type === "TEXT") await loadFont(font);
    assertTarget(t);
    if (parent && (parent.removed || !pageOfNode(parent) || pageOfNode(parent).id !== t.pageId)) throw appErr("PAGE_CHANGED", "\u7236\u8282\u70B9\u5DF2\u79FB\u51FA\u5F53\u524D\u6388\u6743\u9875\u9762\u6216\u88AB\u79FB\u9664");
    let node;
    try {
      const creators = {
        RECTANGLE: "createRectangle",
        ELLIPSE: "createEllipse",
        TEXT: "createText",
        FRAME: "createFrame",
        LINE: "createLine",
        STAR: "createStar"
      };
      markMutation(t);
      node = figma[creators[p.type]]();
      t.affected.push(node.id);
      if (parent) parent.appendChild(node);
      if (p.type === "TEXT") {
        node.fontName = font;
        node.characters = p.text;
      }
      applyProps(node, props, t);
      return buildNodeInfo(node);
    } catch (e) {
      if (node) {
        try {
          node.remove();
          e.state = "rolled_back";
          t.affected = [];
        } catch (cleanup) {
          e.state = "partial";
          e.details = { cleanupError: cleanup.message };
        }
      } else e.state = "unknown";
      throw e;
    }
  }
  async function handleModifyNode(p, t) {
    onlyKeys(p, ["id", "props"]);
    const props = validateModifyProps(p.props);
    const node = await getNode(p.id, t);
    preflightProps(node, props);
    if (node.type === "TEXT" && (hasOwn(props, "width") || hasOwn(props, "height"))) await loadNodeFonts(node);
    assertTarget(t);
    applyProps(node, props, t);
    return buildNodeInfo(node);
  }
  async function handleSetText(p, t) {
    onlyKeys(p, ["id", "text", "fontName", "fontSize", "x", "y"]);
    if (p.text !== void 0) requireStr(p.text, "text", { allowEmpty: true });
    if (p.fontSize !== void 0) requireNum(p.fontSize, "fontSize", 1, 1e3);
    for (const k of ["x", "y"]) if (p[k] !== void 0) requireNum(p[k], k, -1e6, 1e6);
    if (p.fontName !== void 0) {
      onlyKeys(p.fontName, ["family", "style"]);
      requireStr(p.fontName.family, "fontName.family");
      requireStr(p.fontName.style, "fontName.style");
    }
    const node = await getNode(p.id, t);
    if (node.type !== "TEXT") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u6587\u672C\u8282\u70B9");
    if (p.fontName !== void 0 || p.fontSize !== void 0 || p.text !== void 0) await loadNodeFonts(node, p.fontName);
    assertTarget(t);
    try {
      for (const k of ["fontName", "fontSize", "text", "x", "y"]) {
        if (!hasOwn(p, k)) continue;
        markMutation(t, node);
        node[k === "text" ? "characters" : k] = p[k];
      }
    } catch (e) {
      e.state = t.mutating ? "partial" : "not_started";
      throw e;
    }
    return buildNodeInfo(node);
  }
  async function handleDeleteNode(p, t) {
    onlyKeys(p, ["id"]);
    const node = await getNode(p.id, t);
    markMutation(t, node);
    node.remove();
    return { id: p.id, deleted: true };
  }
  var handlers2 = {
    createNode: handleCreateNode,
    modifyNode: handleModifyNode,
    setText: handleSetText,
    deleteNode: handleDeleteNode
  };

  // plugin/src/pages.js
  var handlers3 = {
    async listPages(p, t) {
      onlyKeys(p, []);
      assertTarget(t);
      const pages = figma.root.children.filter((child) => child.type === "PAGE");
      return {
        ...getContext(),
        pages: pages.map((page) => ({
          id: page.id,
          name: String(page.name).slice(0, 1024),
          isCurrent: page.id === figma.currentPage.id,
          childCount: page.id === figma.currentPage.id ? page.children.length : null
        }))
      };
    },
    async managePage(p, t) {
      onlyKeys(p, ["action", "targetPageId", "pageName", "expectedPageName", "confirm"]);
      if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u9875\u9762\u7BA1\u7406\u4EC5\u5728 Figma Design \u6587\u4EF6\u4E2D\u53EF\u7528");
      assertTarget(t);
      if (p.action === "create") {
        requireStr(p.pageName, "pageName");
        const page2 = figma.createPage();
        page2.name = p.pageName;
        return { ...getContext(), created: { id: page2.id, name: page2.name } };
      }
      if (p.action === "list") return handlers3.listPages({}, t);
      const page = await findPage(p.targetPageId);
      if (p.action === "rename") {
        requireStr(p.pageName, "pageName");
        page.name = p.pageName;
        return { ...getContext(), renamed: { id: page.id, name: page.name } };
      }
      if (p.action === "delete") {
        if (p.confirm !== "DELETE") throw appErr("INVALID_PARAM", '\u5220\u9664\u9875\u9762\u5FC5\u987B\u63D0\u4F9B confirm: "DELETE"');
        if (p.expectedPageName !== void 0 && String(page.name) !== p.expectedPageName) {
          throw appErr("TARGET_MISMATCH", "\u9875\u9762\u540D\u79F0\u4E0E\u9884\u671F\u4E0D\u7B26\uFF0C\u5DF2\u62D2\u7EDD\u5220\u9664");
        }
        if (page.id === figma.currentPage.id) throw appErr("INVALID_TARGET", "\u4E0D\u80FD\u5220\u9664\u5F53\u524D\u9875\u9762\uFF0C\u8BF7\u5148\u5207\u9875");
        page.remove();
        return { ...getContext(), deleted: { id: page.id } };
      }
      if (p.action === "switchPage") {
        if (page.id === figma.currentPage.id) return { ...getContext(), switched: true };
        const sourcePageId = figma.currentPage.id;
        const targetPageId = page.id;
        await figma.setCurrentPageAsync(page);
        assertAuthGeneration(t);
        bumpPageRevision();
        return { ...getContext(), switched: true, sourcePageId, targetPageId };
      }
      throw appErr("INVALID_PARAM", "\u672A\u77E5\u9875\u9762\u52A8\u4F5C");
    }
  };
  async function findPage(pageId) {
    requireStr(pageId, "pageId");
    const page = figma.root.children.find((child) => child.type === "PAGE" && child.id === pageId);
    if (!page) throw appErr("PAGE_NOT_FOUND", "\u627E\u4E0D\u5230\u76EE\u6807\u9875\u9762");
    return page;
  }

  // plugin/src/read-layer.js
  var domainMeta = {
    name: "semantic-read",
    actions: ["queryNodes", "getChildren", "readField", "getTextRuns", "getDesignContext"],
    preconditions: ["\u8BFB\u53D6\u8303\u56F4\u9650\u5F53\u524D\u6388\u6743\u9875\u9762\uFF1B\u6210\u5458\u5217\u8868\u56FA\u5B9A\u8BED\u4E49\u89C1\u65BD\u5DE5\u6587\u6863 \xA77"],
    notes: ["\u4E0D\u7ED9\u672A\u8BFB\u5B57\u6BB5\u7F16\u9020\u9ED8\u8BA4\u503C\uFF1B\u533A\u5206 absent/mixed/unsupported/truncated"]
  };
  var OFFSET_CURSOR = /^(0|[1-9][0-9]*)$/;
  var TEXT_SEGMENT_FIELDS = ["fontName", "fontSize", "fills", "lineHeight", "letterSpacing", "textCase", "textDecoration"];
  var TEXT_RUN_LIMIT = 200;
  var STRING_VALUE_LIMIT = 16e3;
  var JSON_VALUE_LIMIT = 24e3;
  var DESIGN_LAYERS = ["layout", "bounds", "text", "components", "variables", "styles", "assets"];
  var DESIGN_DROP_ORDER = ["assets", "styles", "variables", "text", "components", "bounds"];
  var DESIGN_LAYOUT_FIELDS = [
    "x",
    "y",
    "width",
    "height",
    "rotation",
    "layoutMode",
    "itemSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom"
  ];
  var DESIGN_STYLE_FIELDS = ["fillStyleId", "strokeStyleId", "textStyleId", "effectStyleId", "gridStyleId"];
  var RESPONSE_CHAR_LIMIT = 200 * 1024;
  var cursorTokens = /* @__PURE__ */ new Map();
  var cursorTokenSeq = 0;
  function registerCursor(handleId) {
    const token = String(++cursorTokenSeq);
    cursorTokens.set(token, handleId);
    return token;
  }
  function resolveCursor(cursor) {
    return cursorTokens.get(cursor) || cursor;
  }
  function requireInt(v, name, min, max) {
    const n = requireNum(v, name, min, max);
    if (!Number.isInteger(n)) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u6574\u6570`);
    return n;
  }
  function limitOf(p) {
    return p.limit === void 0 ? 50 : requireInt(p.limit, "limit", 1, 100);
  }
  function projectionOf(p) {
    if (p.projection === void 0) return null;
    if (!Array.isArray(p.projection) || p.projection.some((k) => typeof k !== "string")) {
      throw appErr("INVALID_PARAM", "projection \u5FC5\u987B\u662F\u5B57\u7B26\u4E32\u6570\u7EC4");
    }
    return p.projection;
  }
  function parseOffsetCursor(cursor) {
    if (typeof cursor !== "string" || !OFFSET_CURSOR.test(cursor)) {
      throw appErr("INVALID_PARAM", "cursor \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\u7684\u5B57\u7B26\u4E32");
    }
    const offset = Number(cursor);
    if (!Number.isSafeInteger(offset)) throw appErr("INVALID_PARAM", "cursor \u8D85\u51FA\u8303\u56F4\uFF0C\u8BF7\u91CD\u65B0\u4ECE\u9996\u9875\u8BFB\u53D6");
    return offset;
  }
  function readBudget() {
    return { remaining: 100, remainingChars: 56e3 };
  }
  function collectScanNodes() {
    const page = figma.currentPage;
    const found = /* @__PURE__ */ new Map();
    for (const child of page.children || []) found.set(child.id, child);
    if (typeof page.findAll === "function") {
      try {
        for (const node of page.findAll(() => true) || []) if (!found.has(node.id)) found.set(node.id, node);
      } catch (e) {
      }
    }
    const walk = (node) => {
      for (const child of node.children || []) {
        if (!found.has(child.id)) found.set(child.id, child);
        walk(child);
      }
    };
    for (const child of page.children || []) walk(child);
    return [...found.values()];
  }
  function matchesCriteria(node, p) {
    if (p.type !== void 0 && node.type !== p.type) return false;
    const name = String(node.name);
    if (p.nameContains !== void 0 && !name.includes(p.nameContains)) return false;
    if (p.exactName !== void 0 && name !== p.exactName) return false;
    return true;
  }
  async function handleQueryNodes(p, t) {
    onlyKeys(p, ["cursor", "limit", "type", "nameContains", "exactName", "projection"]);
    for (const k of ["type", "nameContains", "exactName"]) if (p[k] !== void 0) requireStr(p[k], k);
    const projection = projectionOf(p);
    const limit = limitOf(p);
    if (p.cursor !== void 0 && p.cursor.startsWith("h_")) {
      const record = readCursor(p.cursor);
      if (record.kind !== "query") throw appErr("CURSOR_INVALID", "\u8BFB\u53D6\u53E5\u67C4\u7C7B\u578B\u4E0D\u7B26");
      const budget2 = readBudget();
      const nodes2 = [];
      let expiredMembers = 0;
      const meta = record.meta;
      const start = meta.offset;
      const slice = meta.memberIds.slice(start, start + limit);
      for (const id of slice) {
        const node = await figma.getNodeByIdAsync(id);
        if (!node || node.removed || !onAuthorizedPage(node)) {
          expiredMembers++;
          meta.offset++;
          continue;
        }
        if (budget2.remainingChars < 18e3 && nodes2.length) break;
        nodes2.push(buildNodeInfo(node, 0, budget2, meta.projection));
        meta.offset++;
      }
      touchCursor(p.cursor);
      const done = meta.offset >= meta.memberIds.length;
      return {
        ...getContext(),
        nodes: nodes2,
        total: meta.memberIds.length,
        expiredMembers: expiredMembers || void 0,
        nextCursor: done ? null : p.cursor,
        truncated: !done
      };
    }
    const offset = p.cursor === void 0 ? 0 : parseOffsetCursor(p.cursor);
    const matches = collectScanNodes().filter((node) => matchesCriteria(node, p));
    const total = matches.length;
    if (offset > total) throw appErr("INVALID_PARAM", "cursor \u8D85\u51FA\u8303\u56F4\uFF0C\u8BF7\u91CD\u65B0\u4ECE\u9996\u9875\u8BFB\u53D6");
    const budget = readBudget();
    const nodes = [];
    for (const node of matches.slice(offset, offset + limit)) {
      if (budget.remainingChars < 18e3 && nodes.length) break;
      nodes.push(buildNodeInfo(node, 0, budget, projection));
    }
    const next = offset + nodes.length;
    let cursorId = null;
    let nextCursor = null;
    if (next < total) {
      try {
        cursorId = createCursor("query", {
          memberIds: matches.slice(next).map((node) => node.id),
          offset: 0,
          projection
        });
        nextCursor = cursorId;
      } catch (e) {
        if (e.code !== "HANDLE_CAPACITY") throw e;
        nextCursor = String(next);
      }
    }
    return {
      ...getContext(),
      nodes,
      total,
      nextCursor,
      truncated: next < total,
      ...cursorId ? {} : { offsetPagination: next < total ? true : void 0 }
    };
  }
  function onAuthorizedPage(node) {
    const page = pageOfNode(node);
    return !!page && page.id === getContext().pageId;
  }
  async function handleGetChildren(p, t, msg) {
    onlyKeys(p, ["cursor", "limit", "id", "projection"]);
    const limit = limitOf(p);
    const projection = projectionOf(p);
    if (p.cursor !== void 0) {
      if (typeof p.cursor !== "string" || !p.cursor.length) throw appErr("INVALID_PARAM", "cursor \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
      const handleId2 = resolveCursor(p.cursor);
      const record = readCursor(handleId2, msg);
      if (record.kind !== "children") throw appErr("INVALID_PARAM", "\u8BFB\u53D6\u53E5\u67C4\u7C7B\u578B\u4E0D\u5339\u914D");
      const memberIds2 = Array.isArray(record.meta.memberIds) ? record.meta.memberIds : [];
      if (p.id !== void 0 && p.id !== record.meta.parentNodeId) {
        throw appErr("INVALID_PARAM", "cursor \u4E0E nodeId \u4E0D\u5339\u914D");
      }
      const offset = Math.min(Math.max(0, Number(record.meta.offset) || 0), memberIds2.length);
      const page = memberIds2.slice(offset, offset + limit);
      const budget2 = readBudget();
      const nodes2 = [];
      let expiredMembers = 0;
      for (const memberId of page) {
        const node2 = await figma.getNodeByIdAsync(memberId);
        if (!node2 || node2.removed || !onAuthorizedPage(node2)) {
          expiredMembers += 1;
          nodes2.push({ id: memberId, expired: true });
          continue;
        }
        nodes2.push(buildNodeInfo(node2, 0, budget2, projection));
      }
      record.meta.offset = offset + page.length;
      touchCursor(handleId2);
      const nextOffset2 = record.meta.offset < memberIds2.length ? record.meta.offset : null;
      return { cursorId: p.cursor, nodes: nodes2, total: memberIds2.length, nextOffset: nextOffset2, truncated: nextOffset2 !== null, expiredMembers };
    }
    const node = await getNode(p.id, t);
    const children = node.children || [];
    const memberIds = children.map((child) => child.id);
    const budget = readBudget();
    const nodes = [];
    for (const child of children.slice(0, limit)) {
      if (budget.remainingChars < 18e3 && nodes.length) break;
      nodes.push(buildNodeInfo(child, 0, budget, projection));
    }
    const handleId = createCursor("children", { parentNodeId: node.id, memberIds, offset: nodes.length });
    const cursorId = registerCursor(handleId);
    const nextOffset = nodes.length < memberIds.length ? nodes.length : null;
    return { cursorId, nodes, total: memberIds.length, nextOffset, truncated: nextOffset !== null };
  }
  function valueStatus(value, extra = {}) {
    if (typeof value === "string" && value.length > STRING_VALUE_LIMIT) {
      return { status: "truncated", value: value.slice(0, STRING_VALUE_LIMIT), valueLength: value.length, ...extra };
    }
    let serialized;
    try {
      serialized = JSON.stringify(value);
    } catch (e) {
      return { status: "unsupported", ...extra };
    }
    if (serialized !== void 0 && serialized.length > JSON_VALUE_LIMIT) {
      return { status: "truncated", valueLength: serialized.length, ...extra };
    }
    return { status: "value", value, ...extra };
  }
  function readFieldValue(node, key, range) {
    if (!(key in node)) return { status: "absent" };
    let raw;
    try {
      raw = node[key];
    } catch (e) {
      return { status: "unsupported" };
    }
    if (raw === void 0) return { status: "absent" };
    if (raw === figma.mixed) return { status: "mixed", value: { mixed: true } };
    if (key === "characters" && range && typeof raw === "string") {
      const start = Math.max(0, Math.min(range.start, raw.length));
      const end = Math.max(0, Math.min(range.end, raw.length));
      const actualStart = utf16SafeBoundary(raw, start);
      let actualEnd = utf16SafeBoundary(raw, end);
      if (actualEnd < actualStart) actualEnd = actualStart;
      return valueStatus(raw.slice(actualStart, actualEnd), { actualStart, actualEnd });
    }
    let value;
    try {
      value = cloneValue(raw);
    } catch (e) {
      return { status: "unsupported" };
    }
    return valueStatus(value);
  }
  async function handleReadField(p, t) {
    onlyKeys(p, ["nodeIds", "fields", "range"]);
    if (!Array.isArray(p.nodeIds) || !p.nodeIds.length || p.nodeIds.some((id) => typeof id !== "string" || !id.length)) {
      throw appErr("INVALID_PARAM", "nodeIds \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u6570\u7EC4");
    }
    if (!Array.isArray(p.fields) || !p.fields.length || p.fields.some((k) => typeof k !== "string" || !k.length)) {
      throw appErr("INVALID_PARAM", "fields \u5FC5\u987B\u662F\u975E\u7A7A\u5B57\u7B26\u4E32\u6570\u7EC4");
    }
    let range = null;
    if (p.range !== void 0) {
      if (!isPlainObject2(p.range)) throw appErr("INVALID_PARAM", "range \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      onlyKeys(p.range, ["start", "end"]);
      const start = requireInt(p.range.start, "range.start", 0, 1e9);
      const end = requireInt(p.range.end, "range.end", 0, 1e9);
      if (end < start) throw appErr("INVALID_PARAM", "range.end \u4E0D\u80FD\u5C0F\u4E8E range.start");
      if (!p.fields.includes("characters")) throw appErr("INVALID_PARAM", "range \u4EC5\u9002\u7528\u4E8E characters \u5B57\u6BB5");
      range = { start, end };
    }
    const results = [];
    for (const id of p.nodeIds) {
      const node = await getNode(id, t);
      const fields = {};
      for (const key of p.fields) fields[key] = readFieldValue(node, key, range);
      results.push({ id: node.id, fields });
    }
    return { results, ...getContext() };
  }
  function textOf(node) {
    const value = node.characters;
    return typeof value === "string" ? value : String(value ?? "");
  }
  function chunkText(characters, offset) {
    const raw = Math.min(offset + LIMITS.TEXT_CHUNK_CHARS, characters.length);
    const boundary = Math.max(offset, utf16SafeBoundary(characters, raw));
    return { text: characters.slice(offset, boundary), nextOffset: boundary < characters.length ? boundary : null };
  }
  async function handleGetTextRuns(p, t, msg) {
    onlyKeys(p, ["id", "cursor"]);
    if (p.cursor !== void 0) {
      if (typeof p.cursor !== "string" || !p.cursor.length) throw appErr("INVALID_PARAM", "cursor \u5FC5\u987B\u662F\u5B57\u7B26\u4E32");
      const handleId2 = resolveCursor(p.cursor);
      const record = readCursor(handleId2, msg);
      if (record.kind !== "text") throw appErr("INVALID_PARAM", "\u8BFB\u53D6\u53E5\u67C4\u7C7B\u578B\u4E0D\u5339\u914D");
      if (p.id !== void 0 && p.id !== record.meta.nodeId) {
        throw appErr("INVALID_PARAM", "cursor \u4E0E nodeId \u4E0D\u5339\u914D");
      }
      const node2 = await getNode(record.meta.nodeId, t);
      if (node2.type !== "TEXT") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u6587\u672C\u8282\u70B9");
      const characters2 = textOf(node2);
      const digest2 = simpleTextDigest(characters2);
      if (digest2 !== record.meta.digest) throw appErr("CURSOR_EXPIRED", "\u6587\u672C\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BFB\u53D6\u53E5\u67C4\u5DF2\u5931\u6548");
      const { text: text2, nextOffset: nextOffset2 } = chunkText(characters2, Number(record.meta.offset) || 0);
      record.meta.offset = nextOffset2 === null ? characters2.length : nextOffset2;
      touchCursor(handleId2);
      return { cursorId: p.cursor, text: text2, charactersLength: characters2.length, contentDigest: digest2, nextOffset: nextOffset2 };
    }
    const node = await getNode(p.id, t);
    if (node.type !== "TEXT") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u6587\u672C\u8282\u70B9");
    const characters = textOf(node);
    const digest = simpleTextDigest(characters);
    const extra = {};
    let runs = [];
    try {
      const segments = node.getStyledTextSegments([...TEXT_SEGMENT_FIELDS]);
      const list = Array.isArray(segments) ? segments.map((segment) => cloneValue(segment)) : [];
      if (list.length > TEXT_RUN_LIMIT) {
        extra.runsTruncated = true;
        runs = list.slice(0, TEXT_RUN_LIMIT);
      } else runs = list;
    } catch (e) {
      extra.runsUnsupported = true;
    }
    const { text, nextOffset } = chunkText(characters, 0);
    const handleId = createCursor("text", { nodeId: node.id, digest, offset: nextOffset === null ? characters.length : nextOffset });
    return { runs, ...extra, text, charactersLength: characters.length, nextOffset, cursorId: registerCursor(handleId), contentDigest: digest };
  }
  function designSummary(node, include, depth, budget) {
    budget.remaining -= 1;
    const name = String(node.name);
    const summary = { id: node.id, name: name.slice(0, 1024), type: node.type, parentId: node.parent ? node.parent.id : null };
    const readErrors = [];
    if (include.has("layout")) {
      const layout = {};
      for (const k of DESIGN_LAYOUT_FIELDS) {
        if (!(k in node)) continue;
        try {
          const v = cloneValue(node[k]);
          if (v !== void 0) layout[k] = v;
        } catch (e) {
          readErrors.push(k);
        }
      }
      if (Object.keys(layout).length) summary.layout = layout;
    }
    if (include.has("bounds")) {
      if ("absoluteBoundingBox" in node) {
        try {
          const box = cloneValue(node.absoluteBoundingBox);
          if (box !== void 0 && box !== null) summary.bounds = box;
        } catch (e) {
          readErrors.push("absoluteBoundingBox");
        }
      } else readErrors.push("absoluteBoundingBox");
    }
    if (include.has("text") && node.type === "TEXT") {
      try {
        const characters = textOf(node);
        summary.text = { characters: summarizeText(characters), charactersLength: characters.length };
      } catch (e) {
        readErrors.push("characters");
      }
    }
    if (include.has("components") && (node.type === "INSTANCE" || node.type === "COMPONENT")) {
      try {
        if (node.type === "INSTANCE") {
          const component = { componentId: cloneValue(node.componentId), name: summary.name };
          if ("key" in node) component.componentKey = cloneValue(node.key);
          if ("variantProperties" in node) component.variantProperties = cloneValue(node.variantProperties);
          summary.component = component;
        } else {
          const component = { componentId: node.id };
          if ("key" in node) component.componentKey = cloneValue(node.key);
          summary.component = component;
        }
      } catch (e) {
        readErrors.push("component");
      }
    }
    if (include.has("variables") && "boundVariables" in node) {
      try {
        const bindings = node.boundVariables;
        const variables = [];
        if (bindings && typeof bindings === "object") {
          for (const field of Object.keys(bindings)) {
            const value = bindings[field];
            for (const item of Array.isArray(value) ? value : [value]) {
              if (item && typeof item === "object" && item.id !== void 0 && item.id !== null) {
                variables.push({ field, variableId: cloneValue(item.id) });
              }
            }
          }
        }
        if (variables.length) summary.variables = variables;
      } catch (e) {
        readErrors.push("boundVariables");
      }
    }
    if (include.has("styles")) {
      const styles = {};
      for (const k of DESIGN_STYLE_FIELDS) {
        if (!(k in node)) continue;
        try {
          const v = cloneValue(node[k]);
          if (v !== void 0 && v !== null) styles[k] = v;
        } catch (e) {
          readErrors.push(k);
        }
      }
      if (Object.keys(styles).length) summary.styles = styles;
    }
    if (include.has("assets") && "fills" in node) {
      try {
        const fills = cloneValue(node.fills);
        const images = Array.isArray(fills) ? fills.filter((paint2) => paint2 && paint2.type === "IMAGE").map((paint2) => ({ imageHash: paint2.imageHash, scaleMode: paint2.scaleMode })) : [];
        if (images.length) summary.assets = images;
      } catch (e) {
        readErrors.push("fills");
      }
    }
    if (readErrors.length) summary.readErrors = readErrors;
    budget.remainingChars -= JSON.stringify(summary).length + 64;
    const children = node.children || [];
    summary.childrenCount = children.length;
    if (depth > 0 && children.length) {
      summary.children = [];
      for (const child of children) {
        if (budget.remaining <= 0 || budget.remainingChars < 2e3) break;
        summary.children.push(designSummary(child, include, depth - 1, budget));
      }
      if (summary.children.length < children.length || summary.children.some((child) => child.truncated)) {
        summary.truncated = true;
      }
    }
    return summary;
  }
  async function handleGetDesignContext(p, t) {
    onlyKeys(p, ["id", "scope", "include", "depth"]);
    const scope = p.scope === void 0 ? "page" : p.scope;
    if (scope !== "page" && scope !== "node") throw appErr("INVALID_PARAM", "scope \u5FC5\u987B\u662F page \u6216 node");
    const depth = p.depth === void 0 ? 2 : requireInt(p.depth, "depth", 0, 6);
    const include = p.include === void 0 ? [...DESIGN_LAYERS] : p.include;
    if (!Array.isArray(include) || include.some((k) => !DESIGN_LAYERS.includes(k))) {
      throw appErr("INVALID_PARAM", "include \u542B\u4E0D\u652F\u6301\u7684\u5C42");
    }
    let roots;
    if (scope === "node") {
      if (p.id === void 0) throw appErr("INVALID_PARAM", "scope=node \u9700\u8981 nodeId");
      roots = [await getNode(p.id, t)];
    } else {
      roots = [...figma.currentPage.children || []];
    }
    const build = (includeSet2, nodeCap2) => {
      const budget = { remaining: Math.max(1, nodeCap2), remainingChars: 4e6 };
      const nodes = [];
      for (const root of roots) {
        if (budget.remaining <= 0) break;
        nodes.push(designSummary(root, includeSet2, depth, budget));
      }
      return { response: { scope, include: [...includeSet2], depth, nodes }, rootsCut: nodes.length < roots.length };
    };
    const includeSet = new Set(include);
    let nodeCap = 2e3;
    let built = build(includeSet, nodeCap);
    let size = JSON.stringify(built.response).length;
    const droppedLayers = [];
    if (size > RESPONSE_CHAR_LIMIT) {
      for (const layer of DESIGN_DROP_ORDER) {
        if (!includeSet.has(layer)) continue;
        includeSet.delete(layer);
        droppedLayers.push(layer);
        built = build(includeSet, nodeCap);
        size = JSON.stringify(built.response).length;
        if (size <= RESPONSE_CHAR_LIMIT) break;
      }
    }
    let listTruncated = false;
    while (size > RESPONSE_CHAR_LIMIT && nodeCap > 1) {
      nodeCap = Math.max(1, Math.floor(nodeCap / 2));
      listTruncated = true;
      built = build(includeSet, nodeCap);
      size = JSON.stringify(built.response).length;
    }
    if (size > RESPONSE_CHAR_LIMIT) {
      throw appErr("RESPONSE_TOO_LARGE", "\u8BBE\u8BA1\u4E0A\u4E0B\u6587\u8D85\u8FC7\u54CD\u5E94\u9884\u7B97\uFF1B\u8BF7\u7F29\u5C0F include \u8303\u56F4\u6216\u964D\u4F4E depth");
    }
    return {
      ...built.response,
      truncated: built.rootsCut || listTruncated || built.response.nodes.some((node) => node.truncated === true),
      ...droppedLayers.length ? { droppedLayers } : {}
    };
  }
  var handlers4 = {
    queryNodes: handleQueryNodes,
    getChildren: handleGetChildren,
    readField: handleReadField,
    getTextRuns: handleGetTextRuns,
    getDesignContext: handleGetDesignContext
  };

  // plugin/src/svg-parser.js
  function parseNumber(text) {
    const value = parseFloat(text);
    if (!Number.isFinite(value)) throw appErr("INVALID_ASSET", "SVG \u6570\u5B57\u683C\u5F0F\u9519\u8BEF: " + text);
    return value;
  }
  function splitArgs(d) {
    return d.trim().split(/[\s,]+/).filter((s) => s.length > 0);
  }
  function colorFrom(value) {
    const v = String(value).trim();
    if (v === "none" || v === "transparent") return null;
    let m = v.match(/^#([0-9a-f]{6})$/i);
    if (m) return { r: parseInt(m[1].slice(0, 2), 16) / 255, g: parseInt(m[1].slice(2, 4), 16) / 255, b: parseInt(m[1].slice(4, 6), 16) / 255 };
    m = v.match(/^#([0-9a-f]{3})$/i);
    if (m) return hexToRgb01("#" + m[1]);
    m = v.match(/^rgb\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*\)$/i);
    if (m) return { r: Math.min(1, Math.max(0, parseNumber(m[1]) / 255)), g: Math.min(1, Math.max(0, parseNumber(m[2]) / 255)), b: Math.min(1, Math.max(0, parseNumber(m[3]) / 255)) };
    m = v.match(/^rgba\(\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*,?\s*([0-9.]+)\s*\)$/i);
    if (m) return { r: Math.min(1, Math.max(0, parseNumber(m[1]) / 255)), g: Math.min(1, Math.max(0, parseNumber(m[2]) / 255)), b: Math.min(1, Math.max(0, parseNumber(m[3]) / 255)), a: Math.min(1, Math.max(0, parseNumber(m[4]))) };
    throw appErr("INVALID_ASSET", "\u4E0D\u652F\u6301\u7684 SVG \u989C\u8272: " + v.slice(0, 64));
  }
  function parseTransform(value) {
    const out = { scaleX: 1, scaleY: 1, dx: 0, dy: 0 };
    if (!value) return out;
    const m = String(value).match(/translate\(\s*([-0-9.]+)\s*(?:[, ]\s*([-0-9.]+))?\s*\)/);
    if (m) {
      out.dx = parseNumber(m[1]);
      if (m[2] !== void 0) out.dy = parseNumber(m[2]);
    }
    const s = String(value).match(/scale\(\s*([-0-9.]+)\s*(?:[, ]\s*([-0-9.]+))?\s*\)/);
    if (s) {
      out.scaleX = parseNumber(s[1]);
      out.scaleY = s[2] !== void 0 ? parseNumber(s[2]) : out.scaleX;
    }
    const matrix2 = String(value).match(/matrix\(\s*([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)[,\s]+([-0-9.]+)\s*\)/);
    if (matrix2) {
      out.scaleX = parseNumber(matrix2[1]);
      out.scaleY = parseNumber(matrix2[4]);
      out.dx = parseNumber(matrix2[5]);
      out.dy = parseNumber(matrix2[6]);
    }
    if (/rotate|skew|scaleY/i.test(String(value)) && !m && !s && !matrix2) throw appErr("INVALID_ASSET", "\u4E0D\u652F\u6301\u7684 SVG \u53D8\u6362: " + String(value).slice(0, 64));
    return out;
  }
  function parseSvgToVectors(svgText, options = {}) {
    if (typeof svgText !== "string" || svgText.length > 4 * 1024 * 1024) throw appErr("INVALID_ASSET", "SVG \u6587\u672C\u4E0D\u5408\u6CD5\u6216\u8FC7\u5927");
    if (/<!ENTITY|<script|onload=|href=|url\(|@import/i.test(svgText)) throw appErr("INVALID_ASSET", "SVG \u5305\u542B\u811A\u672C\u6216\u5916\u90E8\u5F15\u7528\uFF0C\u5DF2\u62D2\u7EDD");
    const shapes = [];
    const rectRe = /<rect\b([^>]*)\/>|<rect\b([^>]*)><\/rect>/gi;
    const circleRe = /<circle\b([^>]*)\/>|<circle\b([^>]*)><\/circle>/gi;
    const ellipseRe = /<ellipse\b([^>]*)\/>|<ellipse\b([^>]*)><\/ellipse>/gi;
    const lineRe = /<line\b([^>]*)\/>|<line\b([^>]*)><\/line>/gi;
    const polyRe = /<(polygon|polyline)\b([^>]*)\/>/gi;
    const pathRe = /<path\b([^>]*)\/>/gi;
    const attr = (tag, name, fallback = null) => {
      const m = tag.match(new RegExp(name + `\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
      return m ? m[2] ?? m[3] ?? m[4] : fallback;
    };
    for (const match of svgText.matchAll(rectRe)) {
      const tag = match[1] || match[2];
      const x = parseNumber(attr(tag, "x", "0"));
      const y = parseNumber(attr(tag, "y", "0"));
      const w = parseNumber(attr(tag, "width", "0"));
      const h = parseNumber(attr(tag, "height", "0"));
      if (w <= 0 || h <= 0) continue;
      const t = parseTransform(attr(tag, "transform"));
      shapes.push({
        kind: "rect",
        x: x * t.scaleX + t.dx,
        y: y * t.scaleY + t.dy,
        w: w * t.scaleX,
        h: h * t.scaleY,
        fill: attr(tag, "fill"),
        fillOpacity: parseNumber(attr(tag, "fill-opacity", "1")),
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "0"))
      });
    }
    for (const match of svgText.matchAll(circleRe)) {
      const tag = match[1] || match[2];
      const cx = parseNumber(attr(tag, "cx", "0"));
      const cy = parseNumber(attr(tag, "cy", "0"));
      const r = parseNumber(attr(tag, "r", "0"));
      if (r <= 0) continue;
      shapes.push({
        kind: "ellipse",
        x: cx - r,
        y: cy - r,
        w: r * 2,
        h: r * 2,
        fill: attr(tag, "fill"),
        fillOpacity: parseNumber(attr(tag, "fill-opacity", "1")),
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "0"))
      });
    }
    for (const match of svgText.matchAll(ellipseRe)) {
      const tag = match[1] || match[2];
      const cx = parseNumber(attr(tag, "cx", "0"));
      const cy = parseNumber(attr(tag, "cy", "0"));
      const rx = parseNumber(attr(tag, "rx", "0"));
      const ry = parseNumber(attr(tag, "ry", "0"));
      if (rx <= 0 || ry <= 0) continue;
      shapes.push({
        kind: "ellipse",
        x: cx - rx,
        y: cy - ry,
        w: rx * 2,
        h: ry * 2,
        fill: attr(tag, "fill"),
        fillOpacity: parseNumber(attr(tag, "fill-opacity", "1")),
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "0"))
      });
    }
    for (const match of svgText.matchAll(lineRe)) {
      const tag = match[1] || match[2];
      const x1 = parseNumber(attr(tag, "x1", "0"));
      const y1 = parseNumber(attr(tag, "y1", "0"));
      const x2 = parseNumber(attr(tag, "x2", "0"));
      const y2 = parseNumber(attr(tag, "y2", "0"));
      if (x1 === x2 && y1 === y2) continue;
      shapes.push({
        kind: "segment",
        x1,
        y1,
        x2,
        y2,
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "1"))
      });
    }
    for (const match of svgText.matchAll(polyRe)) {
      const tag = match[2];
      const closed = match[1].toLowerCase() === "polygon";
      const points = splitArgs(attr(tag, "points", "")).map(parseNumber);
      if (points.length < 4 || points.length % 2 !== 0) continue;
      shapes.push({
        kind: "poly",
        points,
        closed,
        fill: attr(tag, "fill"),
        fillOpacity: parseNumber(attr(tag, "fill-opacity", "1")),
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "0"))
      });
    }
    for (const match of svgText.matchAll(pathRe)) {
      const tag = match[1];
      const d = attr(tag, "d", "");
      if (!d) continue;
      shapes.push({
        kind: "path",
        d,
        fill: attr(tag, "fill"),
        fillOpacity: parseNumber(attr(tag, "fill-opacity", "1")),
        stroke: attr(tag, "stroke"),
        strokeWidth: parseNumber(attr(tag, "stroke-width", "0"))
      });
    }
    if (shapes.length === 0) throw appErr("INVALID_ASSET", "SVG \u672A\u5305\u542B\u53EF\u5BFC\u5165\u7684\u56FE\u5F62\u5143\u7D20");
    const vectors = shapes.map((shape) => shapeToVector(shape)).filter(Boolean);
    if (vectors.length === 0) throw appErr("INVALID_ASSET", "SVG \u56FE\u5F62\u65E0\u6CD5\u8F6C\u6362\u4E3A\u53EF\u7F16\u8F91\u77E2\u91CF");
    return vectors;
  }
  function shapeToVector(shape) {
    const vector = { width: 0, height: 0, vectorPaths: [], vectorNetwork: null };
    const paintFrom = (fill) => {
      if (!fill || fill === "none") return [];
      const color = colorFrom(fill);
      const paint2 = { type: "SOLID", color: { r: color.r, g: color.g, b: color.b } };
      if (color.a !== void 0) paint2.opacity = color.a * (shape.fillOpacity ?? 1);
      return [paint2];
    };
    if (shape.kind === "rect") {
      vector.width = shape.w;
      vector.height = shape.h;
      vector.vectorNetwork = {
        vertices: [{ x: 0, y: 0 }, { x: shape.w, y: 0 }, { x: shape.w, y: shape.h }, { x: 0, y: shape.h }],
        segments: [
          { start: 0, end: 1 },
          { start: 1, end: 2 },
          { start: 2, end: 3 },
          { start: 3, end: 0 }
        ],
        regions: [{ windingRule: "NONZERO", loops: [[0, 1, 2, 3]] }]
      };
      vector.vectorNetwork.vertices.forEach((v) => {
        v.x += shape.x;
        v.y += shape.y;
      });
      vector.fills = paintFrom(shape.fill);
    } else if (shape.kind === "ellipse") {
      const cx = shape.x + shape.w / 2;
      const cy = shape.y + shape.h / 2;
      const rx = shape.w / 2;
      const ry = shape.h / 2;
      vector.width = shape.w;
      vector.height = shape.h;
      const segments = [];
      const points = 48;
      for (let i = 0; i < points; i++) {
        const a = i / points * Math.PI * 2;
        const a2 = (i + 1) / points * Math.PI * 2;
        segments.push({
          start: i,
          end: i + 1,
          tangentStart: { x: -Math.sin(a) * rx, y: Math.cos(a) * ry },
          tangentEnd: { x: -Math.sin(a2) * rx, y: Math.cos(a2) * ry }
        });
      }
      const vertices = [];
      for (let i = 0; i < points; i++) {
        const a = i / points * Math.PI * 2;
        vertices.push({ x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry });
      }
      vertices.push(vertices[0]);
      const loops = [segments.map((_, i) => i)];
      vector.vectorNetwork = { vertices, segments, regions: [{ windingRule: "NONZERO", loops }] };
      vector.fills = paintFrom(shape.fill);
    } else if (shape.kind === "poly" || shape.kind === "path") {
      const points = shape.kind === "poly" ? shape.points : pathToPoints(shape.d);
      if (!points || points.length < 2) return null;
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      vector.width = Math.max(...xs) - minX;
      vector.height = Math.max(...ys) - minY;
      const vertices = points.map((p) => ({ x: p.x - minX, y: p.y - minY }));
      const count = vertices.length;
      const segments = [];
      for (let i = 0; i < count - 1; i++) segments.push({ start: i, end: i + 1 });
      if (shape.closed !== false) {
        segments.push({ start: count - 1, end: 0 });
        vector.vectorNetwork = { vertices, segments, regions: [{ windingRule: "NONZERO", loops: [segments.map((_, i) => i)] }] };
      } else {
        vector.vectorNetwork = { vertices, segments, regions: [] };
      }
      vector.fills = paintFrom(shape.fill);
    } else if (shape.kind === "segment") {
      const minX = Math.min(shape.x1, shape.x2);
      const minY = Math.min(shape.y1, shape.y2);
      vector.width = Math.abs(shape.x2 - shape.x1) || 1;
      vector.height = Math.abs(shape.y2 - shape.y1) || 1;
      vector.vectorNetwork = {
        vertices: [{ x: shape.x1 - minX, y: shape.y1 - minY }, { x: shape.x2 - minX, y: shape.y2 - minY }],
        segments: [{ start: 0, end: 1 }],
        regions: []
      };
      vector.fills = [];
      if (shape.stroke && shape.stroke !== "none") {
        const color = colorFrom(shape.stroke);
        vector.strokes = [{ type: "SOLID", color: { r: color.r, g: color.g, b: color.b } }];
        vector.strokeWeight = shape.strokeWidth || 1;
      }
    } else return null;
    if (shape.stroke && shape.stroke !== "none" && !vector.strokes) {
      try {
        const color = colorFrom(shape.stroke);
        vector.strokes = [{ type: "SOLID", color: { r: color.r, g: color.g, b: color.b } }];
        vector.strokeWeight = shape.strokeWidth || 1;
      } catch {
      }
    }
    return vector;
  }
  function pathToPoints(d) {
    const tokens = d.trim().match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || [];
    const points = [];
    let x = 0, y = 0, startX = 0, startY = 0, current = "M";
    let pending = [];
    let cx = 0, cy = 0;
    let i = 0;
    const take = () => {
      while (pending.length > 0) {
        const token = pending.shift();
        if (/^[a-zA-Z]$/.test(token)) {
          current = token.toUpperCase();
          return current;
        }
        if (token !== "") pending.unshift(token);
        break;
      }
      return null;
    };
    pending = tokens.slice();
    const num = () => {
      while (pending.length && /^[a-zA-Z]$/.test(pending[0])) pending.shift();
      const value = parseNumber(pending.shift());
      if (!Number.isFinite(value)) throw appErr("INVALID_ASSET", "SVG path \u6570\u5B57\u4E0D\u5408\u6CD5");
      return value;
    };
    let segments = 0;
    const emit = (px, py) => {
      points.push({ x: px, y: py });
      if (++segments > 8e3) throw appErr("INVALID_ASSET", "SVG path \u8FC7\u4E8E\u590D\u6742");
    };
    while (pending.length > 0) {
      const next = pending[0];
      if (/^[a-zA-Z]$/.test(next)) {
        current = pending.shift();
      }
      const upper = current.toUpperCase();
      if (upper === "M") {
        x = num();
        y = num();
        if (current === "m") {
          x += points.length ? points[points.length - 1].x : 0;
          y += points.length ? points[points.length - 1].y : 0;
        }
        startX = x;
        startY = y;
        emit(x, y);
        current = current === "m" ? "l" : "L";
      } else if (upper === "L") {
        x = num();
        y = num();
        if (current === "l") {
          x += points[points.length - 1].x;
          y += points[points.length - 1].y;
        }
        emit(x, y);
      } else if (upper === "H") {
        x = num();
        if (current === "h") x += points[points.length - 1].x;
        emit(x, y);
      } else if (upper === "V") {
        y = num();
        if (current === "v") y += points[points.length - 1].y;
        emit(x, y);
      } else if (upper === "C") {
        const c1x = num(), c1y = num(), c2x = num(), c2y = num(), ex = num(), ey = num();
        const abs = current === "C";
        const px = points[points.length - 1].x, py = points[points.length - 1].y;
        const ax = abs ? c1x : c1x + px, ay = abs ? c1y : c1y + py;
        const bx = abs ? c2x : c2x + px, by = abs ? c2y : c2y + py;
        const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
        const STEPS = 24;
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          emit(
            u * u * u * px + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * dx,
            u * u * u * py + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * dy
          );
        }
        x = dx;
        y = dy;
        cx = bx;
        cy = by;
      } else if (upper === "S" || upper === "Q") {
        const c1x = num(), c1y = num(), ex = num(), ey = num();
        const abs = current === upper;
        const px = points[points.length - 1].x, py = points[points.length - 1].y;
        const c0x = upper === "S" ? 2 * px - cx : px, c0y = upper === "S" ? 2 * py - cy : py;
        const ax = abs ? c1x : c1x + px, ay = abs ? c1y : c1y + py;
        const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
        const STEPS = 16;
        for (let s = 1; s <= STEPS; s++) {
          const t = s / STEPS;
          const u = 1 - t;
          emit(u * u * px + 2 * u * t * ax + t * t * dx, u * u * py + 2 * u * t * ay + t * t * dy);
        }
        x = dx;
        y = dy;
        cx = ax;
        cy = ay;
      } else if (upper === "A") {
        const rx = num(), ry = num(), rot = num(), largeArc = num(), sweep = num(), ex = num(), ey = num();
        const abs = current === "A";
        const px = points[points.length - 1].x, py = points[points.length - 1].y;
        const dx = abs ? ex : ex + px, dy = abs ? ey : ey + py;
        const rad = Math.abs(rot) * Math.PI / 180;
        const cosR = Math.cos(rad), sinR = Math.sin(rad);
        const mx = (px - dx) / 2, my = (py - dy) / 2;
        const tx = cosR * mx + sinR * my, ty = -sinR * mx + cosR * my;
        let lambda = tx * tx / (rx * rx) + ty * ty / (ry * ry);
        let rr = rx, rry = ry;
        if (lambda > 1) {
          rr *= Math.sqrt(lambda);
          rry *= Math.sqrt(lambda);
          lambda = 1;
        }
        if (rr <= 0 || rry <= 0) {
          emit(dx, dy);
          x = dx;
          y = dy;
          continue;
        }
        const sign = largeArc !== sweep ? 1 : -1;
        const coef = sign * Math.sqrt(Math.max(0, (1 - lambda) / lambda));
        const ccx = coef * (rr * ty) / rry, ccy = coef * -(rry * tx) / rr;
        const centerX = cosR * ccx - sinR * ccy + (px + dx) / 2;
        const centerY = sinR * ccx + cosR * ccy + (py + dy) / 2;
        const angle = (u2, v2) => {
          let a = Math.atan2(u2[1] * rry, u2[0] * rr);
          const t2 = (u2[0] * v2[0] + u2[1] * v2[1]) / (Math.hypot(u2[0] * rr, u2[1] * rry) * Math.hypot(v2[0] * rr, v2[1] * rry) || 1);
          if (t2 < -1 || t2 > 1) return a;
          const delta2 = Math.acos(Math.max(-1, Math.min(1, t2)));
          return sweep === 0 ? a - delta2 : a + delta2;
        };
        const u = [(tx - ccx) / rr, (ty - ccy) / rry];
        const v = [(-tx - ccx) / rr, (-ty - ccy) / rry];
        let start = Math.atan2(u[1], u[0]);
        let delta = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]) || 1))));
        if (sweep === 0 && delta > 0) delta -= Math.PI * 2;
        if (sweep === 1 && delta < 0) delta += Math.PI * 2;
        const STEPS = 32;
        for (let s = 1; s <= STEPS; s++) {
          const t = start + delta * s / STEPS;
          const local = [rr * Math.cos(t), rry * Math.sin(t)];
          const gx = cosR * local[0] - sinR * local[1] + centerX;
          const gy = sinR * local[0] + cosR * local[1] + centerY;
          emit(gx, gy);
        }
        x = dx;
        y = dy;
      } else if (upper === "Z") {
        if (points.length && (points[points.length - 1].x !== startX || points[points.length - 1].y !== startY)) emit(startX, startY);
      } else {
        throw appErr("INVALID_ASSET", "\u4E0D\u652F\u6301\u7684 SVG path \u547D\u4EE4: " + current);
      }
    }
    return points.length >= 2 ? points : null;
  }

  // plugin/src/assets.js
  var domainMeta2 = {
    name: "assets",
    actions: ["getScreenshot", "exportAsset", "importAsset", "exportVideo"],
    preconditions: ["Figma \u5DF2\u767B\u5F55\u4E14\u6587\u4EF6\u53EF\u5199\uFF1B\u4EA7\u7269\u5199\u5165\u6865\u63A5\u914D\u7F6E\u76EE\u5F55 artifacts/\uFF1B\u5BFC\u5165\u8DEF\u5F84\u9650\u4E8E\u7528\u6237\u4E3B\u76EE\u5F55\u6216\u663E\u5F0F\u5141\u8BB8\u76EE\u5F55"],
    notes: ["MP4 \u4EC5\u9876\u5C42\u5E26\u52A8\u753B Frame\uFF1BSVG \u5BFC\u5165\u4E3A\u6709\u754C\u89E3\u6790\u5B50\u96C6\uFF0C\u5916\u94FE/\u811A\u672C/\u5D4C\u5165\u5185\u5BB9\u62D2\u7EDD\uFF1B\u4E0D\u652F\u6301 URL \u5BFC\u5165"]
  };
  var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  function bytesToBase64(bytes) {
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      const chunk = bytes.subarray(offset, Math.min(offset + 32768, bytes.length));
      binary += String.fromCharCode.apply(null, chunk);
    }
    let out = "";
    for (let i = 0; i < binary.length; i += 3) {
      const b0 = binary.charCodeAt(i);
      const b1 = i + 1 < binary.length ? binary.charCodeAt(i + 1) : -1;
      const b2 = i + 2 < binary.length ? binary.charCodeAt(i + 2) : -1;
      out += B64[b0 >> 2];
      out += B64[(b0 & 3) << 4 | (b1 >= 0 ? b1 >> 4 : 0)];
      out += b1 >= 0 ? B64[(b1 & 15) << 2 | (b2 >= 0 ? b2 >> 6 : 0)] : "=";
      out += b2 >= 0 ? B64[b2 & 63] : "=";
    }
    return out;
  }
  function base64ToBytes(value) {
    if (typeof value !== "string" || value.length % 4 !== 0) throw appErr("INVALID_ASSET", "\u8D44\u6E90\u7F16\u7801\u4E0D\u5408\u6CD5");
    const lookup = new Uint8Array(128);
    for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
    const bytes = new Uint8Array(value.length * 3 / 4);
    let offset = 0;
    for (let i = 0; i < value.length; i += 4) {
      const a = lookup[value.charCodeAt(i)];
      const b = lookup[value.charCodeAt(i + 1)];
      const c = value.charCodeAt(i + 2) === 61 ? 255 : lookup[value.charCodeAt(i + 2)];
      const d = value.charCodeAt(i + 3) === 61 ? 255 : lookup[value.charCodeAt(i + 3)];
      if (a === void 0 || b === void 0) throw appErr("INVALID_ASSET", "\u8D44\u6E90\u7F16\u7801\u4E0D\u5408\u6CD5");
      bytes[offset++] = a << 2 | b >> 4;
      if (c !== 255) bytes[offset++] = (b & 15) << 4 | c >> 2;
      if (d !== 255) bytes[offset++] = (c & 3) << 6 | d;
    }
    return bytes.subarray(0, offset);
  }
  function utf8Length(text) {
    let bytes = text.length;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code > 127) bytes += code > 2047 ? 2 : 1;
    }
    return bytes;
  }
  async function exportBytes(node, settings) {
    const result = await node.exportAsync(settings);
    if (!(result instanceof Uint8Array) && typeof result !== "string") {
      throw appErr("EXPORT_FAILED", "\u5BFC\u51FA\u672A\u8FD4\u56DE\u5B57\u8282");
    }
    return result;
  }
  function constraintFor(longEdge, width, height) {
    if (longEdge === void 0) return { type: "SCALE", value: 1 };
    const size = Math.max(width, height);
    if (size <= 0) return { type: "SCALE", value: 1 };
    return { type: "SCALE", value: Math.min(1, longEdge / size) };
  }
  async function handleExportAsset(p, t, msg) {
    onlyKeys(p, ["id", "format", "scale", "contentsOnly", "useAbsoluteBounds", "svgOutlineText", "svgIdAttribute", "svgSimplifyStroke", "destination", "transferId"]);
    requireStr(p.id, "id");
    const format = requireStr(p.format, "format").toUpperCase();
    const node = await getNode(p.id, t);
    assertTarget(t);
    const base = {
      ...p.contentsOnly !== void 0 ? { contentsOnly: requireBool2(p.contentsOnly, "contentsOnly") } : {},
      ...p.useAbsoluteBounds !== void 0 ? { useAbsoluteBounds: requireBool2(p.useAbsoluteBounds, "useAbsoluteBounds") } : {}
    };
    let settings;
    if (format === "PNG" || format === "JPG") {
      settings = { ...base, format, constraint: { type: "SCALE", value: p.scale === void 0 ? 1 : requireNum(p.scale, "scale", 0.01, 4) } };
    } else if (format === "PDF") {
      settings = { ...base, format: "PDF" };
    } else if (format === "SVG") {
      settings = {
        ...base,
        format: p.destination === "inline" ? "SVG_STRING" : "SVG",
        ...p.svgOutlineText !== void 0 ? { svgOutlineText: requireBool2(p.svgOutlineText, "svgOutlineText") } : {},
        ...p.svgIdAttribute !== void 0 ? { svgIdAttribute: requireBool2(p.svgIdAttribute, "svgIdAttribute") } : {},
        ...p.svgSimplifyStroke !== void 0 ? { svgSimplifyStroke: requireBool2(p.svgSimplifyStroke, "svgSimplifyStroke") } : {}
      };
    } else {
      throw appErr("INVALID_PARAM", "\u4E0D\u652F\u6301\u7684\u5BFC\u51FA\u683C\u5F0F");
    }
    if (format === "PNG" || format === "JPG") {
      const scale = p.scale === void 0 ? 1 : p.scale;
      const pixels = node.width * scale * node.height * scale;
      if (pixels > LIMITS.BITMAP_PIXELS) {
        throw appErr("BITMAP_BUDGET", "\u5BFC\u51FA\u8D85\u51FA 16,777,216 \u50CF\u7D20\u9884\u7B97\uFF1B\u8BF7\u964D\u4F4E scale \u540E\u91CD\u8BD5\uFF0C\u4E0D\u9759\u9ED8\u6539\u53D8\u5BFC\u51FA\u8981\u6C42");
      }
    }
    const data = await exportBytes(node, settings);
    assertTarget(t);
    if (format === "SVG" && p.destination === "inline") {
      const text = typeof data === "string" ? data : new TextDecoder("utf-8").decode(data);
      const size = utf8Length(text);
      if (size > LIMITS.INLINE_PREVIEW_BYTES) throw appErr("INLINE_TOO_LARGE", "\u5185\u8054 SVG \u8D85\u8FC7 128KiB\uFF0C\u8BF7\u4F7F\u7528 destination: file");
      return { inline: true, format: "SVG", mime: "image/svg+xml", bytes: size, data: text };
    }
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    if (bytes.length > LIMITS.RESOURCE_BYTES) throw appErr("EXPORT_TOO_LARGE", "\u5BFC\u51FA\u8D85\u8FC7 16MiB \u4E0A\u9650");
    requireStr(p.transferId, "transferId");
    const base64 = bytesToBase64(bytes);
    await registerUpload(msg.id, p.transferId, msg.operationId || null, bytes.length, base64, {
      format,
      mime: { PNG: "image/png", JPG: "image/jpeg", SVG: "image/svg+xml", PDF: "application/pdf" }[format],
      width: Math.round(node.width),
      height: Math.round(node.height)
    });
    return { transferId: p.transferId, format, totalBytes: bytes.length, width: Math.round(node.width), height: Math.round(node.height) };
  }
  async function handleGetScreenshot(p, t, msg) {
    onlyKeys(p, ["id", "longEdge", "destination", "transferId"]);
    requireStr(p.id, "id");
    const node = await getNode(p.id, t);
    const longEdge = p.longEdge === void 0 ? LIMITS.PREVIEW_LONG_EDGE : requireNum(p.longEdge, "longEdge", 64, LIMITS.PREVIEW_LONG_EDGE_MAX);
    let constraint = constraintFor(longEdge, node.width, node.height);
    const pixels = node.width * constraint.value * node.height * constraint.value;
    if (pixels > LIMITS.BITMAP_PIXELS) {
      throw appErr("BITMAP_BUDGET", "\u622A\u56FE\u8D85\u51FA 16,777,216 \u50CF\u7D20\u9884\u7B97\uFF1B\u8BF7\u51CF\u5C0F longEdge \u6216\u7F29\u5C0F\u8282\u70B9\u540E\u91CD\u8BD5\uFF0C\u4E0D\u9759\u9ED8\u7F29\u653E");
    }
    const bytes = await exportBytes(node, { format: "PNG", constraint, contentsOnly: true });
    assertTarget(t);
    if (!(bytes instanceof Uint8Array)) throw appErr("EXPORT_FAILED", "\u622A\u56FE\u5BFC\u51FA\u672A\u8FD4\u56DE\u5B57\u8282");
    const width = Math.max(1, Math.round(node.width * constraint.value));
    const height = Math.max(1, Math.round(node.height * constraint.value));
    if (p.destination === "file") {
      requireStr(p.transferId, "transferId");
      await registerUpload(msg.id, p.transferId, null, bytes.length, bytesToBase64(bytes), { format: "PNG", mime: "image/png", width, height });
      return { transferId: p.transferId, format: "PNG", totalBytes: bytes.length, width, height };
    }
    if (bytes.length <= LIMITS.INLINE_PREVIEW_BYTES) {
      return {
        inline: true,
        format: "PNG",
        mime: "image/png",
        bytes: bytes.length,
        width,
        height,
        data: "data:image/png;base64," + bytesToBase64(bytes)
      };
    }
    return {
      inline: true,
      format: "PNG",
      mime: "image/png",
      bytes: bytes.length,
      width,
      height,
      data: "data:image/png;base64," + bytesToBase64(bytes)
    };
  }
  async function handleImportAsset(p, t) {
    onlyKeys(p, ["format", "fileName", "totalBytes", "totalSha256", "assetBase64", "x", "y", "parentId", "name", "transferId"]);
    const format = requireStr(p.format, "format").toUpperCase();
    if (p.assetBase64 === void 0) throw appErr("INVALID_ASSET", "\u8D44\u6E90\u672A\u4F20\u8F93\u5B8C\u6574");
    const bytes = base64ToBytes(p.assetBase64);
    if (p.totalBytes !== void 0 && bytes.length !== p.totalBytes) throw appErr("INVALID_ASSET", "\u8D44\u6E90\u5B57\u8282\u6570\u4E0D\u7B26");
    const x = p.x === void 0 ? 0 : requireNum(p.x, "x", -1e6, 1e6);
    const y = p.y === void 0 ? 0 : requireNum(p.y, "y", -1e6, 1e6);
    let parent = null;
    if (p.parentId !== void 0) {
      parent = await getNode(p.parentId, t);
      if (!["FRAME", "COMPONENT", "COMPONENT_SET", "GROUP", "SECTION"].includes(parent.type)) throw appErr("INVALID_TARGET", "parentId \u5FC5\u987B\u662F\u5BB9\u5668\u8282\u70B9");
    }
    assertTarget(t);
    let node = null;
    try {
      if (format === "PNG" || format === "JPEG") {
        const image = figma.createImage(bytes);
        const size = await image.getSizeAsync();
        assertTarget(t);
        markMutation(t);
        node = figma.createRectangle();
        node.name = p.name || (p.fileName ? `img-${p.fileName}` : "imported-image");
        node.resize(size.width, size.height);
        node.x = x;
        node.y = y;
        node.fills = [{ type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }];
        if (parent) parent.appendChild(node);
        t.affected.push(node.id);
      } else if (format === "SVG") {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const vectors = parseSvgToVectors(text);
        assertTarget(t);
        const created = [];
        for (const v of vectors) {
          markMutation(t);
          const vector = figma.createVector();
          if (v.vectorPaths) vector.vectorPaths = v.vectorPaths;
          if (v.vectorNetwork) vector.vectorNetwork = v.vectorNetwork;
          if (v.fills) vector.fills = v.fills;
          if (v.strokes) vector.strokes = v.strokes;
          if (v.strokeWeight !== void 0) vector.strokeWeight = v.strokeWeight;
          vector.x = x + (v.x || 0);
          vector.y = y + (v.y || 0);
          vector.name = p.name || (p.fileName ? `svg-${p.fileName}` : "imported-svg");
          created.push(vector);
        }
        node = created[0];
        if (parent) parent.appendChild(node);
        if (created.length > 1) {
          const group = figma.group(created, parent || node.parent || figma.currentPage);
          group.name = p.name || (p.fileName ? `svg-group-${p.fileName}` : "imported-svg-group");
          node = group;
        }
        t.affected.push(...created.map((n) => n.id));
      } else {
        throw appErr("INVALID_ASSET", "\u4E0D\u652F\u6301\u7684\u5BFC\u5165\u683C\u5F0F");
      }
      return { id: node.id, name: node.name, format, bytes: bytes.length, totalSha256: p.totalSha256 || null };
    } catch (e) {
      if (e && e.code) throw e;
      if (node && !node.removed) {
        try {
          node.remove();
        } catch {
        }
      }
      const detail = e instanceof Error ? e.message || String(e) : JSON.stringify(e);
      throw appErr("IMPORT_FAILED", "\u5BFC\u5165\u5931\u8D25: " + detail);
    }
  }
  async function startVideoJob(p, t) {
    onlyKeys(p, ["id", "format", "fps", "quality", "scale", "width", "height", "transferId"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (!node.parent || node.parent.type !== "PAGE") throw appErr("INVALID_TARGET", "\u89C6\u9891\u5BFC\u51FA\u4EC5\u652F\u6301\u9876\u5C42 Frame");
    if (typeof node.exportAsync !== "function") throw appErr("EDITOR_UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u89C6\u9891\u5BFC\u51FA");
    const constraint = p.width !== void 0 || p.height !== void 0 ? { type: p.width !== void 0 ? "WIDTH" : "HEIGHT", value: requireNum(p.width !== void 0 ? p.width : p.height, "constraint", 1, 3840) } : { type: "SCALE", value: p.scale === void 0 ? 1 : p.scale };
    const settings = {
      format: "MP4",
      ...p.fps !== void 0 ? { fps: p.fps } : {},
      ...p.quality !== void 0 ? { quality: p.quality } : {},
      constraint
    };
    const bytes = await exportBytes(node, settings);
    assertTarget(t);
    if (!(bytes instanceof Uint8Array)) throw appErr("EXPORT_FAILED", "\u89C6\u9891\u5BFC\u51FA\u672A\u8FD4\u56DE\u5B57\u8282");
    if (bytes.length > LIMITS.RESOURCE_BYTES) throw appErr("EXPORT_TOO_LARGE", "\u89C6\u9891\u8D85\u8FC7 16MiB \u4E0A\u9650");
    const transferId = "v" + Date.now().toString(36) + Math.random().toString(36).slice(2, 14);
    await registerUpload(transferId, transferId, t.operationId || null, bytes.length, bytesToBase64(bytes), {
      format: "MP4",
      mime: "video/mp4",
      width: Math.round(node.width),
      height: Math.round(node.height)
    });
    return { format: "MP4", totalBytes: bytes.length, width: Math.round(node.width), height: Math.round(node.height) };
  }
  var schemas = {
    importAsset: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["PNG", "JPEG", "SVG"] },
        fileName: { type: "string", maxLength: 1024 },
        totalBytes: { type: "integer", minimum: 0, maximum: LIMITS.RESOURCE_BYTES },
        totalSha256: { type: "string", maxLength: 64 },
        assetBase64: { type: "string" },
        x: { type: "number", minimum: -1e6, maximum: 1e6 },
        y: { type: "number", minimum: -1e6, maximum: 1e6 },
        parentId: { type: "string", maxLength: 1024 },
        name: { type: "string", maxLength: 1e4 }
      },
      required: ["format", "assetBase64"],
      additionalProperties: false
    }
  };
  var handlers5 = {
    exportAsset: handleExportAsset,
    getScreenshot: handleGetScreenshot,
    importAsset: handleImportAsset
  };
  function requireBool2(v, name) {
    if (typeof v !== "boolean") throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
    return v;
  }

  // plugin/src/hierarchy.js
  var domainMeta3 = {
    name: "hierarchy",
    actions: ["clone", "group", "ungroup", "reparent", "reorder"],
    preconditions: [],
    notes: [
      "clone \u4F9D\u8D56 node.clone()\uFF08\u771F\u673A\u590D\u5236\u5230\u540C\u7236\u5E76\u4FDD\u6301\u539F\u4F4D\uFF0C\u53EF\u53E0\u52A0\u4F4D\u7F6E\u504F\u79FB\uFF09",
      "reparent \u7684 keepAbsolute \u4F9D\u8D56 absoluteTransform\uFF08\u771F\u673A\u53EF\u7528\uFF1B\u8FD0\u884C\u65F6\u7F3A\u5931\u65F6\u5982\u5B9E\u8FD4\u56DE UNSUPPORTED\uFF09",
      "group \u8981\u6C42\u5168\u90E8\u8282\u70B9\u4F4D\u4E8E\u540C\u4E00\u7236\u8282\u70B9\u4E0B\uFF1Bungroup \u4F18\u5148 figma.ungroup\uFF0C\u7F3A\u5931\u65F6\u624B\u52A8\u4E0A\u79FB\u5B50\u8282\u70B9\u540E\u79FB\u9664\u7EC4"
    ]
  };
  function requireFigmaEditor() {
    if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u5C42\u7EA7\u547D\u4EE4\u4EC5\u5728 Figma Design \u7F16\u8F91\u5668\u53EF\u7528");
  }
  function translationOf(m) {
    if (!Array.isArray(m) || !Array.isArray(m[0]) || !Array.isArray(m[1])) return null;
    if (!Number.isFinite(m[0][2]) || !Number.isFinite(m[1][2])) return null;
    return [m[0][2], m[1][2]];
  }
  async function handleClone(p, t) {
    onlyKeys(p, ["action", "id", "name"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (typeof node.clone !== "function") throw appErr("UNSUPPORTED", `${node.type} \u4E0D\u652F\u6301 clone`);
    markMutation(t, node);
    const clone = node.clone();
    if (!clone.parent && node.parent && typeof node.parent.appendChild === "function") node.parent.appendChild(clone);
    if (p.name !== void 0) clone.name = p.name;
    markMutation(t, clone);
    return buildNodeInfo(clone);
  }
  async function handleGroup(p, t) {
    onlyKeys(p, ["action", "nodeIds", "name"]);
    if (!Array.isArray(p.nodeIds) || p.nodeIds.length < 1 || p.nodeIds.length > 100) {
      throw appErr("INVALID_PARAM", "nodeIds \u5FC5\u987B\u662F 1..100 \u4E2A\u8282\u70B9 id");
    }
    const nodes = [];
    for (const id of p.nodeIds) nodes.push(await getNode(id, t));
    assertTarget(t);
    const parent = nodes[0].parent;
    if (!parent) throw appErr("INVALID_TARGET", "\u5FC5\u987B\u4F4D\u4E8E\u540C\u4E00\u7236\u8282\u70B9\u4E0B");
    for (const node of nodes) {
      if (!node.parent || node.parent.id !== parent.id) throw appErr("INVALID_TARGET", "\u5FC5\u987B\u4F4D\u4E8E\u540C\u4E00\u7236\u8282\u70B9\u4E0B");
    }
    if (typeof figma.group !== "function") throw appErr("UNSUPPORTED", "figma.group \u4E0D\u53EF\u7528");
    const group = figma.group(nodes, parent);
    if (p.name !== void 0) group.name = p.name;
    markMutation(t, group);
    for (const node of nodes) markMutation(t, node);
    return buildNodeInfo(group);
  }
  async function handleUngroup(p, t) {
    onlyKeys(p, ["action", "id"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (node.type !== "GROUP") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F GROUP");
    const children = [...node.children || []];
    markMutation(t);
    if (!t.affected.includes(node.id)) t.affected.push(node.id);
    if (typeof figma.ungroup === "function") {
      const moved = figma.ungroup(node);
      const list = Array.isArray(moved) && moved.length ? moved : children;
      for (const child of list) markMutation(t, child);
      return { children: list.map((child) => child.id) };
    }
    const parent = node.parent;
    if (!parent || typeof parent.appendChild !== "function") throw appErr("UNSUPPORTED", "\u7236\u5BB9\u5668\u4E0D\u652F\u6301\u63A5\u6536\u5B50\u8282\u70B9");
    for (const child of children) {
      parent.appendChild(child);
      markMutation(t, child);
    }
    node.remove();
    return { children: children.map((child) => child.id) };
  }
  async function handleReparent(p, t) {
    onlyKeys(p, ["action", "id", "parentId", "position"]);
    const position = p.position === void 0 ? "keepLocal" : p.position;
    if (position !== "keepLocal" && position !== "keepAbsolute") {
      throw appErr("INVALID_PARAM", "position \u5FC5\u987B\u662F keepLocal \u6216 keepAbsolute");
    }
    const node = await getNode(p.id, t);
    const parent = await getNode(p.parentId, t, { allowContainer: true });
    assertTarget(t);
    if (parent.type === "DOCUMENT") throw appErr("INVALID_TARGET", "parentId \u4E0D\u80FD\u662F DOCUMENT");
    for (let cursor = parent; cursor; cursor = cursor.parent) {
      if (cursor.id === node.id) throw appErr("INVALID_TARGET", "\u62D2\u7EDD\u5FAA\u73AF\u5C42\u7EA7");
    }
    if (typeof parent.appendChild !== "function") throw appErr("INVALID_TARGET", "parentId \u4E0D\u652F\u6301\u5B50\u8282\u70B9");
    if (position === "keepAbsolute") {
      const nodeTranslation = translationOf(node.absoluteTransform);
      const parentTranslation = translationOf(parent.absoluteTransform);
      if (!nodeTranslation || !parentTranslation) {
        throw appErr("UNSUPPORTED", "keepAbsolute \u9700\u8981 absoluteTransform\uFF08\u771F\u673A\u53EF\u7528\uFF09");
      }
      markMutation(t, node);
      parent.appendChild(node);
      node.x = nodeTranslation[0] - parentTranslation[0];
      node.y = nodeTranslation[1] - parentTranslation[1];
    } else {
      markMutation(t, node);
      parent.appendChild(node);
    }
    return buildNodeInfo(node);
  }
  async function handleReorder(p, t) {
    onlyKeys(p, ["action", "id", "index", "beforeNodeId"]);
    const hasIndex = p.index !== void 0;
    const hasBefore = p.beforeNodeId !== void 0;
    if (hasIndex === hasBefore) throw appErr("INVALID_PARAM", "index \u4E0E beforeNodeId \u5FC5\u987B\u6070\u597D\u63D0\u4F9B\u4E00\u4E2A");
    const node = await getNode(p.id, t);
    assertTarget(t);
    const parent = node.parent;
    if (!parent || typeof parent.insertChild !== "function") throw appErr("INVALID_TARGET", "\u76EE\u6807\u8282\u70B9\u6CA1\u6709\u53EF\u91CD\u6392\u7684\u7236\u5BB9\u5668");
    let target;
    if (hasBefore) {
      const before = await getNode(p.beforeNodeId, t);
      const at = parent.children.indexOf(before);
      if (at < 0) throw appErr("INVALID_PARAM", "beforeNodeId \u4E0D\u5728\u540C\u4E00\u7236\u8282\u70B9\u4E0B");
      target = at;
    } else {
      if (!Number.isInteger(p.index) || p.index < 0 || p.index > parent.children.length) {
        throw appErr("INVALID_PARAM", "index \u8D8A\u754C");
      }
      target = p.index;
    }
    markMutation(t, node);
    parent.insertChild(target, node);
    return { id: node.id, index: parent.children.indexOf(node) };
  }
  var handlers6 = {
    hierarchy: async (p, t) => {
      requireFigmaEditor();
      if (!isPlainObject2(p)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      switch (p.action) {
        case "clone":
          return handleClone(p, t);
        case "group":
          return handleGroup(p, t);
        case "ungroup":
          return handleUngroup(p, t);
        case "reparent":
          return handleReparent(p, t);
        case "reorder":
          return handleReorder(p, t);
        default:
          throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
      }
    }
  };

  // plugin/src/vector.js
  var domainMeta4 = {
    name: "vector",
    actions: ["createPolygon", "createVectorPaths", "boolean", "setShapeParams", "setVectorNetwork"],
    preconditions: [],
    notes: [
      "\u5E03\u5C14\u8FD0\u7B97\u8D70\u5B98\u65B9 figma.union/subtract/intersect/exclude\uFF08nodes, parent \u7B7E\u540D\uFF09\uFF1BSUBTRACT \u8BED\u4E49\u4E3A nodes[0] \u51CF\u5176\u4F59\uFF0C\u987A\u5E8F\u900F\u4F20",
      "vectorPaths \u7684 data \u5FC5\u987B\u662F\u4EE5 M/m \u5F00\u5934\u7684\u975E\u7A7A SVG \u8DEF\u5F84\u5B57\u7B26\u4E32\uFF1BvectorNetwork \u8D4B\u503C\u524D\u6821\u9A8C\u9876\u70B9/\u7EBF\u6BB5\u7D22\u5F15",
      "pointCount \u4EC5 POLYGON/STAR\uFF0CinnerRadius \u4EC5 STAR\uFF1B\u7ED3\u679C\u4E3A\u53EF\u7F16\u8F91\u8282\u70B9\uFF0C\u56DE\u8BFB\u8282\u70B9\u4FE1\u606F"
    ]
  };
  var WINDING_RULES = ["NONZERO", "EVENODD", "NONE"];
  var BOOLEAN_FNS = { UNION: "union", SUBTRACT: "subtract", INTERSECT: "intersect", EXCLUDE: "exclude" };
  function requireFigmaEditor2() {
    if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u77E2\u91CF\u547D\u4EE4\u4EC5\u5728 Figma Design \u7F16\u8F91\u5668\u53EF\u7528");
  }
  function applyFailure(e, applied, node) {
    const failure2 = appErr("PROP_APPLY_FAILED", e.message);
    failure2.state = applied.length ? "partial" : "not_started";
    failure2.details = { appliedProperties: applied };
    if (applied.length && node && !node.removed && node.parent) failure2.details.readBack = buildNodeInfo(node);
    return failure2;
  }
  function validatePaths(paths) {
    if (!Array.isArray(paths) || paths.length < 1) throw appErr("INVALID_PARAM", "paths \u5FC5\u987B\u662F 1..64 \u4E2A\u8DEF\u5F84\u5BF9\u8C61");
    if (paths.length > 64) throw appErr("INVALID_PARAM", "paths \u6570\u91CF\u8D85\u8FC7 64");
    return paths.map((raw, i) => {
      const label = `paths[${i}]`;
      if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61`);
      if (!WINDING_RULES.includes(raw.windingRule)) throw appErr("INVALID_PARAM", `${label}.windingRule \u975E\u6CD5`);
      if (typeof raw.data !== "string" || !raw.data.length || !/^[Mm]/.test(raw.data)) {
        throw appErr("INVALID_PARAM", `${label}.data \u5FC5\u987B\u662F\u4EE5 M \u5F00\u5934\u7684\u975E\u7A7A SVG \u8DEF\u5F84\u5B57\u7B26\u4E32`);
      }
      return { windingRule: raw.windingRule, data: raw.data };
    });
  }
  async function handleCreatePolygon(p, t) {
    onlyKeys(p, ["action", "pointCount", "polygonWidth", "polygonHeight", "x", "y", "cornerRadius", "name", "parentId"]);
    const parent = p.parentId === void 0 ? null : await getNode(p.parentId, t);
    assertTarget(t);
    if (typeof figma.createPolygon !== "function") throw appErr("UNSUPPORTED", "figma.createPolygon \u4E0D\u53EF\u7528");
    let node;
    try {
      markMutation(t);
      node = figma.createPolygon();
      if (!t.affected.includes(node.id)) t.affected.push(node.id);
      if (parent) parent.appendChild(node);
      if (hasOwn(p, "pointCount")) {
        markMutation(t, node);
        node.pointCount = p.pointCount;
      }
      if (hasOwn(p, "polygonWidth") || hasOwn(p, "polygonHeight")) {
        markMutation(t, node);
        node.resize(
          hasOwn(p, "polygonWidth") ? p.polygonWidth : node.width,
          hasOwn(p, "polygonHeight") ? p.polygonHeight : node.height
        );
      }
      for (const k of ["x", "y", "cornerRadius"]) {
        if (!hasOwn(p, k)) continue;
        markMutation(t, node);
        node[k] = p[k];
      }
      if (p.name !== void 0) {
        markMutation(t, node);
        node.name = p.name;
      }
      const out = buildNodeInfo(node);
      if ("pointCount" in node) out.pointCount = cloneValue(node.pointCount);
      return out;
    } catch (e) {
      if (node) {
        try {
          node.remove();
          e.state = "rolled_back";
          t.affected = [];
        } catch (cleanup) {
          e.state = "partial";
          e.details = { cleanupError: cleanup.message };
        }
      } else e.state = "unknown";
      throw e;
    }
  }
  async function handleCreateVectorPaths(p, t) {
    onlyKeys(p, ["action", "paths", "x", "y", "name", "parentId"]);
    const paths = validatePaths(p.paths);
    const parent = p.parentId === void 0 ? null : await getNode(p.parentId, t);
    assertTarget(t);
    if (typeof figma.createVector !== "function") throw appErr("UNSUPPORTED", "figma.createVector \u4E0D\u53EF\u7528");
    let node;
    try {
      markMutation(t);
      node = figma.createVector();
      if (!t.affected.includes(node.id)) t.affected.push(node.id);
      if (parent) parent.appendChild(node);
      for (const k of ["x", "y"]) {
        if (!hasOwn(p, k)) continue;
        markMutation(t, node);
        node[k] = p[k];
      }
      if (p.name !== void 0) {
        markMutation(t, node);
        node.name = p.name;
      }
      markMutation(t, node);
      node.vectorPaths = paths;
      return { ...buildNodeInfo(node), vectorPaths: cloneValue(node.vectorPaths) };
    } catch (e) {
      if (node) {
        try {
          node.remove();
          e.state = "rolled_back";
          t.affected = [];
        } catch (cleanup) {
          e.state = "partial";
          e.details = { cleanupError: cleanup.message };
        }
      } else e.state = "unknown";
      throw e;
    }
  }
  async function handleBoolean(p, t) {
    onlyKeys(p, ["action", "nodeIds", "operation", "parentId"]);
    if (!Array.isArray(p.nodeIds) || p.nodeIds.length !== 2) {
      throw appErr("INVALID_PARAM", "nodeIds \u5FC5\u987B\u6070\u597D\u662F\u4E24\u4E2A\u8282\u70B9 id");
    }
    if (typeof p.operation !== "string" || !BOOLEAN_FNS[p.operation]) {
      throw appErr("INVALID_PARAM", "operation \u5FC5\u987B\u662F UNION/SUBTRACT/INTERSECT/EXCLUDE");
    }
    const fn = BOOLEAN_FNS[p.operation];
    if (typeof figma[fn] !== "function") throw appErr("UNSUPPORTED", `figma.${fn} \u4E0D\u53EF\u7528`);
    const a = await getNode(p.nodeIds[0], t);
    const b = await getNode(p.nodeIds[1], t);
    assertTarget(t);
    const parent = p.parentId === void 0 ? a.parent || figma.currentPage : await getNode(p.parentId, t);
    const bool2 = figma[fn]([a, b], parent);
    markMutation(t, bool2);
    markMutation(t, a);
    markMutation(t, b);
    return buildNodeInfo(bool2);
  }
  async function handleSetShapeParams(p, t) {
    onlyKeys(p, ["action", "id", "pointCount", "innerRadius", "cornerRadius"]);
    const keys = ["pointCount", "innerRadius", "cornerRadius"].filter((k) => hasOwn(p, k));
    if (!keys.length) throw appErr("INVALID_PARAM", "pointCount/innerRadius/cornerRadius \u81F3\u5C11\u63D0\u4F9B\u4E00\u9879");
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (hasOwn(p, "pointCount")) {
      if (node.type !== "POLYGON" && node.type !== "STAR") throw appErr("INVALID_PARAM", "pointCount \u4EC5\u652F\u6301 POLYGON/STAR");
      if (!Number.isInteger(p.pointCount) || p.pointCount < 3 || p.pointCount > 60) {
        throw appErr("INVALID_PARAM", "pointCount \u9700\u5728 [3,60]");
      }
    }
    if (hasOwn(p, "innerRadius")) {
      if (node.type !== "STAR") throw appErr("INVALID_PARAM", "innerRadius \u4EC5\u652F\u6301 STAR");
      if (!isFiniteNum(p.innerRadius, 0, 1)) throw appErr("INVALID_PARAM", "innerRadius \u9700\u5728 [0,1]");
    }
    if (hasOwn(p, "cornerRadius") && !("cornerRadius" in node)) {
      throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 cornerRadius`);
    }
    const applied = [];
    try {
      for (const k of keys) {
        node[k] = p[k];
        markMutation(t, node);
        applied.push(k);
      }
    } catch (e) {
      throw applyFailure(e, applied, node);
    }
    const out = buildNodeInfo(node);
    if ("pointCount" in node) out.pointCount = cloneValue(node.pointCount);
    if ("innerRadius" in node) out.innerRadius = cloneValue(node.innerRadius);
    return out;
  }
  function validateVectorNetwork(network) {
    if (!isPlainObject2(network)) throw appErr("INVALID_PARAM", "vectorNetwork \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    if (!Array.isArray(network.vertices) || network.vertices.length < 2) {
      throw appErr("INVALID_PARAM", "vectorNetwork.vertices \u5FC5\u987B\u662F\u81F3\u5C11 2 \u4E2A\u9876\u70B9\u7684\u6570\u7EC4");
    }
    for (const vertex of network.vertices) {
      if (!isPlainObject2(vertex)) throw appErr("INVALID_PARAM", "vectorNetwork.vertices \u5143\u7D20\u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    }
    if (!Array.isArray(network.segments)) throw appErr("INVALID_PARAM", "vectorNetwork.segments \u5FC5\u987B\u662F\u6570\u7EC4");
    const count = network.vertices.length;
    network.segments.forEach((segment, i) => {
      const label = `vectorNetwork.segments[${i}]`;
      if (!isPlainObject2(segment)) throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61`);
      for (const k of ["start", "end"]) {
        if (!Number.isInteger(segment[k]) || segment[k] < 0 || segment[k] >= count) {
          throw appErr("INVALID_PARAM", `${label}.${k} \u5FC5\u987B\u662F\u9876\u70B9\u7D22\u5F15`);
        }
      }
    });
    if (network.regions !== void 0 && !Array.isArray(network.regions)) {
      throw appErr("INVALID_PARAM", "vectorNetwork.regions \u5FC5\u987B\u662F\u6570\u7EC4");
    }
    return network;
  }
  async function handleSetVectorNetwork(p, t) {
    onlyKeys(p, ["action", "id", "vectorNetwork"]);
    const network = JSON.parse(JSON.stringify(validateVectorNetwork(p.vectorNetwork)));
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (node.type !== "VECTOR") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F VECTOR \u8282\u70B9");
    if (!("vectorNetwork" in node)) throw appErr("UNSUPPORTED", `${node.type} \u4E0D\u652F\u6301 vectorNetwork`);
    markMutation(t, node);
    try {
      node.vectorNetwork = network;
    } catch (e) {
      throw applyFailure(e, [], node);
    }
    return { ...buildNodeInfo(node), vectorNetwork: cloneValue(node.vectorNetwork) };
  }
  var handlers7 = {
    vector: async (p, t) => {
      requireFigmaEditor2();
      if (!isPlainObject2(p)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      switch (p.action) {
        case "createPolygon":
          return handleCreatePolygon(p, t);
        case "createVectorPaths":
          return handleCreateVectorPaths(p, t);
        case "boolean":
          return handleBoolean(p, t);
        case "setShapeParams":
          return handleSetShapeParams(p, t);
        case "setVectorNetwork":
          return handleSetVectorNetwork(p, t);
        default:
          throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
      }
    }
  };

  // plugin/src/layout.js
  var domainMeta5 = {
    name: "layout",
    actions: ["setLayout", "setChildLayout", "removeLayout", "setConstraints"],
    preconditions: [],
    notes: [
      "setLayout \u4E3A\u90E8\u5206\u66F4\u65B0\uFF1A\u82E5\u63D0\u4F9B layoutMode \u5219\u5148\u8D4B\u503C\u518D\u8D4B\u5176\u4F59\u952E\uFF08\u771F\u5B9E Figma \u9700\u5148\u5B9A\u65B9\u5411\uFF09\uFF1B\u5C5E\u6027\u5B58\u5728\u6027\u4E0E\u90E8\u5206\u5931\u8D25\u8BED\u4E49\u4E0E edit.js \u4E00\u81F4",
      "setChildLayout \u4EC5\u4F5C\u7528\u4E8E\u5BB9\u5668\u7684\u76F4\u63A5\u5B50\u8282\u70B9\uFF08child.parent.id \u5FC5\u987B\u7B49\u4E8E\u76EE\u6807 id\uFF09",
      "setConstraints \u5408\u5E76\u8282\u70B9\u65E2\u6709 constraints\uFF0C\u672A\u63D0\u4F9B\u7684\u65B9\u5411\u6CBF\u7528\u539F\u503C\uFF08\u7F3A\u7701 MIN\uFF09"
    ]
  };
  var SET_LAYOUT_KEYS = [
    "layoutMode",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "itemSpacing",
    "counterAxisSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "layoutWrap",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight"
  ];
  var CHILD_LAYOUT_KEYS = [
    "layoutAlign",
    "layoutGrow",
    "layoutPositioning",
    "layoutSizingHorizontal",
    "layoutSizingVertical"
  ];
  var CONSTRAINT_KEYS = ["horizontalConstraint", "verticalConstraint"];
  function requireFigmaEditor3() {
    if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u5E03\u5C40\u547D\u4EE4\u4EC5\u5728 Figma Design \u7F16\u8F91\u5668\u53EF\u7528");
  }
  function requireProps(p, keys) {
    const props = p.props;
    if (!isPlainObject2(props)) throw appErr("INVALID_PARAM", "props \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    onlyKeys(props, keys);
    if (!Object.keys(props).length) throw appErr("INVALID_PARAM", "props \u81F3\u5C11\u5305\u542B\u4E00\u9879");
    return props;
  }
  function orderLayoutProps(props) {
    const ordered = {};
    if (hasOwn(props, "layoutMode")) ordered.layoutMode = props.layoutMode;
    for (const k of Object.keys(props)) if (k !== "layoutMode") ordered[k] = props[k];
    return ordered;
  }
  async function handleSetLayout(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = orderLayoutProps(requireProps(p, SET_LAYOUT_KEYS));
    const node = await getNode(p.id, t);
    assertTarget(t);
    applyProps(node, props, t);
    return buildNodeInfo(node);
  }
  async function handleSetChildLayout(p, t) {
    onlyKeys(p, ["action", "id", "childIds", "props"]);
    const props = requireProps(p, CHILD_LAYOUT_KEYS);
    if (!Array.isArray(p.childIds) || p.childIds.length < 1 || p.childIds.length > 100) {
      throw appErr("INVALID_PARAM", "childIds \u5FC5\u987B\u662F 1..100 \u4E2A\u8282\u70B9 id");
    }
    const container = await getNode(p.id, t);
    const children = [];
    for (const childId of p.childIds) {
      const child = await getNode(childId, t);
      if (!child.parent || child.parent.id !== container.id) {
        throw appErr("INVALID_TARGET", "\u5B50\u8282\u70B9\u4E0D\u5728\u76EE\u6807\u5BB9\u5668\u5185");
      }
      children.push(child);
    }
    assertTarget(t);
    const results = [];
    for (const child of children) {
      applyProps(child, props, t);
      results.push({ id: child.id, applied: Object.keys(props) });
    }
    return { children: results };
  }
  async function handleRemoveLayout(p, t) {
    onlyKeys(p, ["action", "id"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (!("layoutMode" in node)) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 layoutMode`);
    markMutation(t, node);
    node.layoutMode = "NONE";
    return buildNodeInfo(node);
  }
  async function handleSetConstraints(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps(p, CONSTRAINT_KEYS);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (!("constraints" in node)) throw appErr("UNSUPPORTED", `${node.type} \u4E0D\u652F\u6301 constraints`);
    const current = node.constraints && typeof node.constraints === "object" && !Array.isArray(node.constraints) ? node.constraints : {};
    const next = {
      horizontal: hasOwn(props, "horizontalConstraint") ? props.horizontalConstraint : current.horizontal || "MIN",
      vertical: hasOwn(props, "verticalConstraint") ? props.verticalConstraint : current.vertical || "MIN"
    };
    markMutation(t, node);
    try {
      node.constraints = next;
    } catch (e) {
      const failure2 = appErr("PROP_APPLY_FAILED", e.message);
      failure2.state = "not_started";
      failure2.details = { appliedProperties: [] };
      throw failure2;
    }
    return { ...buildNodeInfo(node), constraints: cloneValue(node.constraints) };
  }
  var handlers8 = {
    layout: async (p, t) => {
      requireFigmaEditor3();
      if (!isPlainObject2(p)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      switch (p.action) {
        case "setLayout":
          return handleSetLayout(p, t);
        case "setChildLayout":
          return handleSetChildLayout(p, t);
        case "removeLayout":
          return handleRemoveLayout(p, t);
        case "setConstraints":
          return handleSetConstraints(p, t);
        default:
          throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
      }
    }
  };

  // plugin/src/text-range.js
  var domainMeta6 = {
    name: "text-range",
    actions: ["getStyles", "setStyles"],
    preconditions: [],
    notes: [
      "setStyles \u5199\u524D\u52A0\u8F7D\u5B57\u4F53\uFF0C\u52A0\u8F7D\u5931\u8D25\u62A5 FONT_NOT_LOADABLE\uFF0C\u4E0D\u9759\u9ED8\u66FF\u6362\u5B57\u4F53",
      "\u533A\u95F4 clamp \u5230 [0, characters.length] \u5E76\u6309 UTF-16 \u4FEE\u6B63\uFF0C\u4E0D\u843D\u5728\u4EE3\u7406\u5BF9\u4E2D\u95F4",
      "getStyles \u5BF9\u5012\u7F6E\u533A\u95F4\u6309 [min,max] \u8BFB\u53D6\uFF1BsetStyles \u62D2\u7EDD\u4FEE\u6B63\u540E end<=start \u7684\u533A\u95F4",
      "\u8282\u70B9\u7F3A\u5931 getRange*/setRange* \u65B9\u6CD5\u65F6\u5982\u5B9E\u8FD4\u56DE unsupported\uFF0C\u4E0D\u7F16\u9020\u9ED8\u8BA4\u503C"
    ]
  };
  var STYLE_KEYS = ["fontName", "fontSize", "lineHeight", "letterSpacing", "fills", "textCase", "textDecoration"];
  var APPLY_ORDER = ["fontName", "fontSize", "lineHeight", "letterSpacing", "fills", "textCase", "textDecoration"];
  var READ_METHODS = {
    fontName: "getRangeFontName",
    fontSize: "getRangeFontSize",
    lineHeight: "getRangeLineHeight",
    letterSpacing: "getRangeLetterSpacing",
    fills: "getRangeFills",
    textCase: "getRangeTextCase",
    textDecoration: "getRangeTextDecoration"
  };
  var WRITE_METHODS = {
    fontName: "setRangeFontName",
    fontSize: "setRangeFontSize",
    lineHeight: "setRangeLineHeight",
    letterSpacing: "setRangeLetterSpacing",
    fills: "setRangeFills",
    textCase: "setRangeTextCase",
    textDecoration: "setRangeTextDecoration"
  };
  var SEGMENT_FIELDS = ["fontName", "fontSize", "fills", "lineHeight", "letterSpacing", "textCase", "textDecoration"];
  var SEGMENT_LIMIT = 100;
  var LINE_HEIGHT_UNITS = ["PIXELS", "PERCENT", "AUTO"];
  var LETTER_SPACING_UNITS = ["PIXELS", "PERCENT"];
  var TEXT_CASES = ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"];
  var TEXT_DECORATIONS = ["NONE", "UNDERLINE", "STRIKETHROUGH"];
  function requireRangeIndex(v, name) {
    if (!Number.isInteger(v) || v < 0) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570`);
    return v;
  }
  function resolveRange(text, p, { rejectInverted }) {
    const len = text.length;
    const rawStart = p.start === void 0 ? 0 : requireRangeIndex(p.start, "start");
    const rawEnd = p.end === void 0 ? len : requireRangeIndex(p.end, "end");
    let start = utf16SafeBoundary(text, Math.min(rawStart, len));
    let end = utf16SafeBoundary(text, Math.min(rawEnd, len));
    if (rejectInverted) {
      if (end <= start) {
        throw appErr("INVALID_PARAM", `\u4FEE\u6B63\u540E\u533A\u95F4\u4E3A\u7A7A\uFF08actualStart=${start}, actualEnd=${end}\uFF09\uFF1BsetStyles \u8981\u6C42 end > start`);
      }
    } else if (end < start) {
      const swapped = start;
      start = end;
      end = swapped;
    }
    return { start, end };
  }
  function readRangeStyles(node, start, end) {
    const styles = {};
    for (const key of STYLE_KEYS) {
      const method = READ_METHODS[key];
      if (typeof node[method] !== "function") {
        styles[key] = { status: "unsupported" };
        continue;
      }
      try {
        const value = cloneValue(node[method](start, end));
        styles[key] = value === void 0 ? { status: "unsupported" } : value;
      } catch (e) {
        styles[key] = { status: "unsupported" };
      }
    }
    return styles;
  }
  function readSegments(node, start, end) {
    if (typeof node.getStyledTextSegments !== "function") return { segments: [], segmentsTotal: 0 };
    let raw = [];
    try {
      raw = node.getStyledTextSegments(SEGMENT_FIELDS, start, end) || [];
    } catch (e) {
      return { segments: [], segmentsTotal: 0 };
    }
    const segments = raw.slice(0, SEGMENT_LIMIT).map((segment) => {
      const out = {};
      if (typeof segment.characters === "string") out.characters = summarizeText(segment.characters, 64);
      if (segment.start !== void 0) out.start = segment.start;
      if (segment.end !== void 0) out.end = segment.end;
      for (const key of STYLE_KEYS) {
        if (!(key in segment)) continue;
        const value = cloneValue(segment[key]);
        if (value !== void 0) out[key] = value;
      }
      return out;
    });
    return {
      segments,
      segmentsTotal: raw.length,
      ...raw.length > SEGMENT_LIMIT ? { segmentsTruncated: true } : {}
    };
  }
  async function handleGetStyles(p, t) {
    const node = await getNode(p.id, t);
    if (node.type !== "TEXT") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u6587\u672C\u8282\u70B9");
    const characters = node.characters;
    const { start, end } = resolveRange(characters, p, { rejectInverted: false });
    return {
      id: node.id,
      charactersLength: characters.length,
      actualStart: start,
      actualEnd: end,
      styles: readRangeStyles(node, start, end),
      ...readSegments(node, start, end),
      ...getContext()
    };
  }
  function normalizeUnitValue(v, name, units, min, max) {
    if (!isPlainObject2(v)) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u6570\u503C\u6216 {unit, value} \u5BF9\u8C61`);
    onlyKeys(v, ["unit", "value"]);
    if (!units.includes(v.unit)) throw appErr("INVALID_PARAM", `${name}.unit \u975E\u6CD5: ${String(v.unit)}`);
    return { unit: v.unit, value: requireNum(v.value, `${name}.value`, min, max) };
  }
  function normalizeStyles(raw) {
    if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", "styles \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61\u4E14\u81F3\u5C11\u5305\u542B\u4E00\u9879\u6837\u5F0F");
    const keys = Object.keys(raw);
    if (!keys.length) throw appErr("INVALID_PARAM", "styles \u81F3\u5C11\u5305\u542B\u4E00\u9879\u8981\u4FEE\u6539\u7684\u6837\u5F0F");
    const out = {};
    for (const key of keys) {
      if (!STYLE_KEYS.includes(key)) throw appErr("INVALID_PARAM", `\u4E0D\u652F\u6301\u7684\u6837\u5F0F\u5B57\u6BB5: ${key}`);
      const v = raw[key];
      if (key === "fontName") {
        if (!isPlainObject2(v)) throw appErr("INVALID_PARAM", "fontName \u5FC5\u987B\u662F {family, style} \u5BF9\u8C61");
        onlyKeys(v, ["family", "style"]);
        out.fontName = { family: requireStr(v.family, "fontName.family"), style: requireStr(v.style, "fontName.style") };
      } else if (key === "fontSize") {
        out.fontSize = requireNum(v, "fontSize", 1, 1e3);
      } else if (key === "lineHeight") {
        out.lineHeight = typeof v === "number" ? { unit: "PIXELS", value: requireNum(v, "lineHeight", 0, 1e5) } : normalizeUnitValue(v, "lineHeight", LINE_HEIGHT_UNITS, 0, 1e5);
      } else if (key === "letterSpacing") {
        out.letterSpacing = typeof v === "number" ? { unit: "PIXELS", value: requireNum(v, "letterSpacing", -1e5, 1e5) } : normalizeUnitValue(v, "letterSpacing", LETTER_SPACING_UNITS, -1e5, 1e5);
      } else if (key === "fills") {
        out.fills = validatePaints(v, "fills");
      } else if (key === "textCase") {
        if (!TEXT_CASES.includes(v)) throw appErr("INVALID_PARAM", `textCase \u975E\u6CD5: ${String(v)}`);
        out.textCase = v;
      } else if (key === "textDecoration") {
        if (!TEXT_DECORATIONS.includes(v)) throw appErr("INVALID_PARAM", `textDecoration \u975E\u6CD5: ${String(v)}`);
        out.textDecoration = v;
      }
    }
    return out;
  }
  async function handleSetStyles(p, t) {
    const styles = normalizeStyles(p.styles);
    const node = await getNode(p.id, t);
    if (node.type !== "TEXT") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u6587\u672C\u8282\u70B9");
    const { start, end } = resolveRange(node.characters, p, { rejectInverted: true });
    if (styles.fontName) await loadFont(styles.fontName);
    else await loadNodeFonts(node);
    for (const key of Object.keys(styles)) {
      const method = WRITE_METHODS[key];
      if (typeof node[method] !== "function") {
        throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 ${method}`);
      }
    }
    assertTarget(t);
    const applied = [];
    try {
      for (const key of APPLY_ORDER) {
        if (!hasOwn(styles, key)) continue;
        markMutation(t, node);
        node[WRITE_METHODS[key]](start, end, styles[key]);
        applied.push(key);
      }
    } catch (e) {
      const failure2 = appErr("PROP_APPLY_FAILED", e.message);
      failure2.state = t.mutating ? "partial" : "not_started";
      failure2.details = { appliedProperties: applied, appliedStart: start, appliedEnd: end };
      throw failure2;
    }
    assertTarget(t);
    return {
      id: node.id,
      charactersLength: node.characters.length,
      appliedStart: start,
      appliedEnd: end,
      appliedProperties: applied,
      styles: readRangeStyles(node, start, end),
      ...getContext()
    };
  }
  async function handleTextRange(p, t) {
    onlyKeys(p, ["id", "action", "start", "end", "styles", "cursor"]);
    if (p.action === "getStyles") return handleGetStyles(p, t);
    if (p.action === "setStyles") return handleSetStyles(p, t);
    throw appErr("INVALID_PARAM", "action \u5FC5\u987B\u662F getStyles \u6216 setStyles");
  }
  var handlers9 = {
    textRange: handleTextRange
  };

  // plugin/src/visual.js
  var domainMeta7 = {
    name: "visual",
    actions: ["setEffects", "setBlend", "setClip", "setMask", "setGrids", "setStrokeDetail", "setCornerRadii"],
    preconditions: [],
    notes: [
      "effects \u4E0E layoutGrids \u5148\u6574\u4F53\u6821\u9A8C\u518D\u4E00\u6B21\u6027\u8D4B\u503C\uFF1BblendMode \u91C7\u7528\u8FD0\u884C\u65F6\u767D\u540D\u5355\uFF08\u5171\u4EAB\u6CE8\u518C\u8868\u8BE5\u5B57\u6BB5\u4E3A\u81EA\u7531\u5B57\u7B26\u4E32\uFF09",
      "\u5206\u8FB9\u63CF\u8FB9\uFF08strokeTop/Bottom/Left/RightWeight\uFF09\u4E0E\u5206\u89D2\u5706\u89D2\u4EC5\u5728\u8282\u70B9\u62E5\u6709\u5BF9\u5E94\u5C5E\u6027\u65F6\u53EF\u8BBE\uFF0C\u5426\u5219\u5982\u5B9E\u62A5\u9519",
      "setMask \u7684 maskType \u4EC5\u5728\u8282\u70B9\u652F\u6301\u65F6\u8D4B\u503C\uFF1BisMask=true \u8981\u6C42\u8282\u70B9\u5DF2\u6709\u7236\u8282\u70B9"
    ]
  };
  var EFFECT_TYPES = /* @__PURE__ */ new Set(["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR", "NOISE", "TEXTURE", "SHADER"]);
  var SHADOW_TYPES = /* @__PURE__ */ new Set(["DROP_SHADOW", "INNER_SHADOW"]);
  var BLUR_TYPES = /* @__PURE__ */ new Set(["LAYER_BLUR", "BACKGROUND_BLUR"]);
  var BLEND_MODES = /* @__PURE__ */ new Set([
    "PASS_THROUGH",
    "NORMAL",
    "DARKEN",
    "MULTIPLY",
    "LINEAR_BURN",
    "COLOR_BURN",
    "LIGHTEN",
    "SCREEN",
    "LINEAR_DODGE",
    "COLOR_DODGE",
    "OVERLAY",
    "SOFT_LIGHT",
    "HARD_LIGHT",
    "DIFFERENCE",
    "EXCLUSION",
    "HUE",
    "SATURATION",
    "COLOR",
    "LUMINOSITY"
  ]);
  var GRID_TYPES = ["GRID_COLUMNS", "GRID_ROWS", "GRID_UNIFORM"];
  var GRID_ALIGNMENTS = ["MIN", "CENTER", "MAX", "STRETCH", "SCALE"];
  var STROKE_ENUMS = {
    strokeAlign: ["INSIDE", "OUTSIDE", "CENTER"],
    strokeCap: ["NONE", "ROUND", "SQUARE", "ARROW_LINES", "ARROW_EQUILATERAL"],
    strokeJoin: ["MITER", "BEVEL", "ROUND"]
  };
  var SIDE_WEIGHT_KEYS = ["strokeTopWeight", "strokeBottomWeight", "strokeLeftWeight", "strokeRightWeight"];
  var STROKE_KEYS = ["strokeAlign", "strokeCap", "strokeJoin", "strokeMiterLimit", "dashPattern", ...SIDE_WEIGHT_KEYS];
  var CORNER_KEYS = ["topLeftRadius", "topRightRadius", "bottomLeftRadius", "bottomRightRadius"];
  function requireFigmaEditor4() {
    if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u89C6\u89C9\u547D\u4EE4\u4EC5\u5728 Figma Design \u7F16\u8F91\u5668\u53EF\u7528");
  }
  function requireProps2(p, keys) {
    const props = p.props;
    if (!isPlainObject2(props)) throw appErr("INVALID_PARAM", "props \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    onlyKeys(props, keys);
    if (!Object.keys(props).length) throw appErr("INVALID_PARAM", "props \u81F3\u5C11\u5305\u542B\u4E00\u9879");
    return props;
  }
  function applyFailure2(e, applied, node) {
    const failure2 = appErr("PROP_APPLY_FAILED", e.message);
    failure2.state = applied.length ? "partial" : "not_started";
    failure2.details = { appliedProperties: applied };
    if (applied.length && !node.removed && pageOfNode(node) && pageOfNode(node).id === figma.currentPage.id) {
      failure2.details.readBack = buildNodeInfo(node);
    }
    return failure2;
  }
  function validateEffects(effects) {
    if (!Array.isArray(effects)) throw appErr("INVALID_PARAM", "effects \u5FC5\u987B\u662F\u6570\u7EC4");
    if (effects.length > 32) throw appErr("INVALID_PARAM", "effects \u6570\u91CF\u8D85\u8FC7 32");
    return effects.map((raw, i) => {
      const label = `effects[${i}]`;
      if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61`);
      if (typeof raw.type !== "string" || !EFFECT_TYPES.has(raw.type)) {
        throw appErr("INVALID_PARAM", `${label}.type \u975E\u6CD5`);
      }
      if (SHADOW_TYPES.has(raw.type)) {
        for (const k of ["color", "offset", "radius", "visible", "blendMode"]) {
          if (!(k in raw)) throw appErr("INVALID_PARAM", `${label} \u7F3A\u5C11 ${k}`);
        }
        const color = raw.color;
        if (!isPlainObject2(color)) throw appErr("INVALID_PARAM", `${label}.color \u5FC5\u987B\u662F {r,g,b,a} \u5BF9\u8C61`);
        for (const ch of ["r", "g", "b", "a"]) {
          if (!isFiniteNum(color[ch], 0, 1)) throw appErr("INVALID_PARAM", `${label}.color.${ch} \u9700\u5728 [0,1]`);
        }
        const offset = raw.offset;
        if (!isPlainObject2(offset) || !isFiniteNum(offset.x, -1e6, 1e6) || !isFiniteNum(offset.y, -1e6, 1e6)) {
          throw appErr("INVALID_PARAM", `${label}.offset \u5FC5\u987B\u662F {x,y}`);
        }
        if (!isFiniteNum(raw.radius, 0, 1e5)) throw appErr("INVALID_PARAM", `${label}.radius \u9700\u5728 [0,1e5]`);
        if (typeof raw.visible !== "boolean") throw appErr("INVALID_PARAM", `${label}.visible \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
        if (typeof raw.blendMode !== "string" || !raw.blendMode) throw appErr("INVALID_PARAM", `${label}.blendMode \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
      }
      if (BLUR_TYPES.has(raw.type)) {
        if (!isFiniteNum(raw.radius, 0, 1e5)) throw appErr("INVALID_PARAM", `${label}.radius \u9700\u5728 [0,1e5]`);
        if (typeof raw.visible !== "boolean") throw appErr("INVALID_PARAM", `${label} \u7F3A\u5C11 visible`);
      }
      if (raw.type === "NOISE") {
        for (const k of ["noiseSize", "density"]) {
          if (k in raw && !isFiniteNum(raw[k], 0, 1)) throw appErr("INVALID_PARAM", `${label}.${k} \u9700\u5728 [0,1]`);
        }
      }
      if (raw.type === "TEXTURE" && "noiseSize" in raw && !isFiniteNum(raw.noiseSize, 0, 1)) {
        throw appErr("INVALID_PARAM", `${label}.noiseSize \u9700\u5728 [0,1]`);
      }
      if (raw.type === "SHADER" && "properties" in raw && !isPlainObject2(raw.properties)) {
        throw appErr("INVALID_PARAM", `${label}.properties \u5FC5\u987B\u662F\u5BF9\u8C61`);
      }
      return JSON.parse(JSON.stringify(raw));
    });
  }
  function validateGrids(grids) {
    if (!Array.isArray(grids)) throw appErr("INVALID_PARAM", "layoutGrids \u5FC5\u987B\u662F\u6570\u7EC4");
    if (grids.length > 16) throw appErr("INVALID_PARAM", "layoutGrids \u6570\u91CF\u8D85\u8FC7 16");
    return grids.map((raw, i) => {
      const label = `layoutGrids[${i}]`;
      if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61`);
      if (!GRID_TYPES.includes(raw.type)) throw appErr("INVALID_PARAM", `${label}.type \u975E\u6CD5`);
      const allowed = raw.type === "GRID_UNIFORM" ? ["type", "sectionSize"] : ["type", "count", "sectionSize", "gutterSize", "alignment"];
      for (const k of Object.keys(raw)) {
        if (!allowed.includes(k)) throw appErr("INVALID_PARAM", `${label} \u4E0D\u652F\u6301 ${k}`);
      }
      if (raw.type === "GRID_UNIFORM") {
        if (!isFiniteNum(raw.sectionSize, 0, 1e5)) throw appErr("INVALID_PARAM", `${label}.sectionSize \u9700\u5728 [0,1e5]`);
        return { type: raw.type, sectionSize: raw.sectionSize };
      }
      const out = { type: raw.type };
      const hasCount = raw.count !== void 0;
      const hasSection = raw.sectionSize !== void 0;
      if (!hasCount && !hasSection) throw appErr("INVALID_PARAM", `${label} \u9700\u8981 count \u6216 sectionSize`);
      if (hasCount) {
        if (!Number.isInteger(raw.count) || raw.count < 1 || raw.count > 100) {
          throw appErr("INVALID_PARAM", `${label}.count \u9700\u5728 [1,100]`);
        }
        out.count = raw.count;
      }
      if (hasSection) {
        if (!isFiniteNum(raw.sectionSize, 0, 1e5)) throw appErr("INVALID_PARAM", `${label}.sectionSize \u9700\u5728 [0,1e5]`);
        out.sectionSize = raw.sectionSize;
      }
      if (raw.gutterSize !== void 0) {
        if (!isFiniteNum(raw.gutterSize, 0, 1e5)) throw appErr("INVALID_PARAM", `${label}.gutterSize \u9700\u5728 [0,1e5]`);
        out.gutterSize = raw.gutterSize;
      }
      if (raw.alignment !== void 0) {
        if (!GRID_ALIGNMENTS.includes(raw.alignment)) throw appErr("INVALID_PARAM", `${label}.alignment \u975E\u6CD5`);
        out.alignment = raw.alignment;
      }
      return out;
    });
  }
  async function handleSetEffects(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const effects = validateEffects(requireProps2(p, ["effects"]).effects);
    const node = await getNode(p.id, t);
    assertTarget(t);
    markMutation(t, node);
    try {
      node.effects = effects;
    } catch (e) {
      throw applyFailure2(e, [], node);
    }
    return { ...buildNodeInfo(node), effects: cloneValue(node.effects) };
  }
  async function handleSetBlend(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps2(p, ["blendMode"]);
    if (typeof props.blendMode !== "string" || !BLEND_MODES.has(props.blendMode)) {
      throw appErr("INVALID_PARAM", "blendMode \u975E\u6CD5");
    }
    const node = await getNode(p.id, t);
    assertTarget(t);
    markMutation(t, node);
    try {
      node.blendMode = props.blendMode;
    } catch (e) {
      throw applyFailure2(e, [], node);
    }
    return { ...buildNodeInfo(node), blendMode: node.blendMode };
  }
  async function handleSetClip(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps2(p, ["clipsContent"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (!("clipsContent" in node)) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 clipsContent`);
    markMutation(t, node);
    try {
      node.clipsContent = props.clipsContent;
    } catch (e) {
      throw applyFailure2(e, [], node);
    }
    return { ...buildNodeInfo(node), clipsContent: node.clipsContent };
  }
  async function handleSetMask(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps2(p, ["isMask", "maskType"]);
    if (typeof props.isMask !== "boolean") throw appErr("INVALID_PARAM", "isMask \u5FC5\u987B\u662F\u5E03\u5C14\u503C");
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (props.isMask && !node.parent) throw appErr("INVALID_PARAM", "isMask=true \u9700\u8981\u8282\u70B9\u5DF2\u6709\u7236\u8282\u70B9");
    const steps = [["isMask", props.isMask]];
    if (props.maskType !== void 0 && "maskType" in node) steps.push(["maskType", props.maskType]);
    markMutation(t, node);
    const applied = [];
    try {
      for (const [k, v] of steps) {
        node[k] = v;
        applied.push(k);
      }
    } catch (e) {
      throw applyFailure2(e, applied, node);
    }
    const out = { ...buildNodeInfo(node), isMask: node.isMask };
    if ("maskType" in node) out.maskType = cloneValue(node.maskType);
    return out;
  }
  async function handleSetGrids(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const grids = validateGrids(requireProps2(p, ["layoutGrids"]).layoutGrids);
    const node = await getNode(p.id, t);
    assertTarget(t);
    markMutation(t, node);
    try {
      node.layoutGrids = grids;
    } catch (e) {
      throw applyFailure2(e, [], node);
    }
    return { ...buildNodeInfo(node), layoutGrids: cloneValue(node.layoutGrids) };
  }
  async function handleSetStrokeDetail(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps2(p, STROKE_KEYS);
    const node = await getNode(p.id, t);
    assertTarget(t);
    const order = STROKE_KEYS.filter((k) => hasOwn(props, k));
    for (const k of order) {
      if (SIDE_WEIGHT_KEYS.includes(k)) {
        if (!(k in node)) throw appErr("INVALID_PARAM", "\u8BE5\u8282\u70B9\u7C7B\u578B\u4E0D\u652F\u6301\u5206\u8FB9\u63CF\u8FB9");
        if (!isFiniteNum(props[k], 0, 1e5)) throw appErr("INVALID_PARAM", `${k} \u9700\u5728 [0,1e5]`);
      } else if (!(k in node)) {
        throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 ${k}`);
      }
    }
    for (const [k, allowed] of Object.entries(STROKE_ENUMS)) {
      if (hasOwn(props, k) && !allowed.includes(props[k])) throw appErr("INVALID_PARAM", `${k} \u975E\u6CD5`);
    }
    if (hasOwn(props, "strokeMiterLimit") && !isFiniteNum(props.strokeMiterLimit, 0, 1e3)) {
      throw appErr("INVALID_PARAM", "strokeMiterLimit \u9700\u5728 [0,1000]");
    }
    if (hasOwn(props, "dashPattern")) {
      if (!Array.isArray(props.dashPattern) || props.dashPattern.length > 32) {
        throw appErr("INVALID_PARAM", "dashPattern \u5FC5\u987B\u662F \u226432 \u4E2A\u6570\u5B57\u7684\u6570\u7EC4");
      }
      for (const v of props.dashPattern) {
        if (!isFiniteNum(v, 0, 1e5)) throw appErr("INVALID_PARAM", "dashPattern \u5143\u7D20\u9700\u5728 [0,1e5]");
      }
    }
    markMutation(t, node);
    const applied = [];
    try {
      for (const k of order) {
        node[k] = props[k];
        applied.push(k);
      }
    } catch (e) {
      throw applyFailure2(e, applied, node);
    }
    const out = buildNodeInfo(node);
    for (const k of STROKE_KEYS) {
      if (k in node) out[k] = cloneValue(node[k]);
    }
    return out;
  }
  async function handleSetCornerRadii(p, t) {
    onlyKeys(p, ["action", "id", "props"]);
    const props = requireProps2(p, [...CORNER_KEYS, "cornerSmoothing"]);
    const node = await getNode(p.id, t);
    assertTarget(t);
    const order = CORNER_KEYS.filter((k) => hasOwn(props, k));
    for (const k of order) {
      if (!(k in node)) throw appErr("INVALID_PARAM", "\u8BE5\u8282\u70B9\u7C7B\u578B\u4E0D\u652F\u6301\u5206\u89D2\u5706\u89D2");
      if (!isFiniteNum(props[k], 0, 1e5)) throw appErr("INVALID_PARAM", `${k} \u9700\u5728 [0,1e5]`);
    }
    if (hasOwn(props, "cornerSmoothing")) {
      if (!("cornerSmoothing" in node)) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 cornerSmoothing`);
      if (!isFiniteNum(props.cornerSmoothing, 0, 1)) throw appErr("INVALID_PARAM", "cornerSmoothing \u9700\u5728 [0,1]");
    }
    const steps = [...order.map((k) => [k, props[k]]), ...hasOwn(props, "cornerSmoothing") ? [["cornerSmoothing", props.cornerSmoothing]] : []];
    markMutation(t, node);
    const applied = [];
    try {
      for (const [k, v] of steps) {
        node[k] = v;
        applied.push(k);
      }
    } catch (e) {
      throw applyFailure2(e, applied, node);
    }
    const out = buildNodeInfo(node);
    for (const k of [...CORNER_KEYS, "cornerSmoothing"]) {
      if (k in node) out[k] = cloneValue(node[k]);
    }
    return out;
  }
  var handlers10 = {
    visual: async (p, t) => {
      requireFigmaEditor4();
      if (!isPlainObject2(p)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      switch (p.action) {
        case "setEffects":
          return handleSetEffects(p, t);
        case "setBlend":
          return handleSetBlend(p, t);
        case "setClip":
          return handleSetClip(p, t);
        case "setMask":
          return handleSetMask(p, t);
        case "setGrids":
          return handleSetGrids(p, t);
        case "setStrokeDetail":
          return handleSetStrokeDetail(p, t);
        case "setCornerRadii":
          return handleSetCornerRadii(p, t);
        default:
          throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
      }
    }
  };

  // plugin/src/design-system.js
  var domainMeta8 = {
    name: "design-system",
    actions: [
      "listCollections",
      "listVariables",
      "getVariable",
      "createVariable",
      "renameVariable",
      "deleteVariable",
      "setValue",
      "createMode",
      "renameMode",
      "deleteMode",
      "resolveValue",
      "setBoundVariable",
      "list",
      "get",
      "create",
      "update",
      "apply",
      "delete",
      "createFromNode",
      "createInstance",
      "combineAsVariants",
      "swap",
      "detach",
      "getInstanceInfo",
      "setInstanceProperty",
      "addComponentProperty",
      "editComponentProperty",
      "deleteComponentProperty",
      "importVariable",
      "importComponent",
      "importStyle"
    ],
    preconditions: ["teamlibrary \u6743\u9650\u5DF2\u58F0\u660E\uFF1B\u5E93\u53D1\u73B0\u9700\u7528\u6237\u5DF2\u5728 Figma UI \u542F\u7528\u5E93"],
    notes: [
      "\u53D8\u91CF\u91CD\u547D\u540D\u7ECF name \u5C5E\u6027\u8D4B\u503C\u3001\u5220\u9664\u7ECF remove()\uFF1B\u6A21\u5F0F\u7ECF collection.addMode(name)/renameMode(modeId,name)/removeMode(modeId)",
      'setBoundVariable \u5B98\u65B9\u7B7E\u540D\u4E3A (field, Variable|null)\uFF1Bfills/strokes \u7ECF setBoundVariableForPaint(paint,"color",variable) \u9010 paint \u7ED1\u5B9A',
      '\u6837\u5F0F lineHeight/letterSpacing \u6309\u5DE5\u5177\u5951\u7EA6\u6570\u5B57\u4F20\u53C2\uFF0C\u843D\u5730\u4E3A {unit:"PIXELS", value}\uFF1BTEXT \u521B\u5EFA/\u66F4\u65B0\u5148 loadFontAsync',
      "\u6837\u5F0F\u5E94\u7528\u4F18\u5148 set*StyleIdAsync\uFF0C\u7F3A\u5931\u65F6\u9000\u56DE *StyleId \u5C5E\u6027\u8D4B\u503C",
      "combineAsVariants \u9700\u8981 nodeIds(2..64)\u3001createInstance \u9700\u8981 parentId\uFF0C\u5171\u4EAB\u6CE8\u518C\u8868 figma_components \u6682\u65E0\u8FD9\u4E24\u4E2A\u5B57\u6BB5\uFF0C\u7EBF\u4E0A\u8C03\u7528\u4F1A\u88AB schema \u62D2\u7EDD\uFF08\u5F85\u5951\u7EA6\u4FEE\u8BA2\uFF09",
      "variables \u7684 value \u5728\u5171\u4EAB\u6CE8\u518C\u8868\u4E2D\u9650\u5B9A\u4E3A object\uFF0CFLOAT/BOOLEAN/STRING \u539F\u59CB\u503C\u4F1A\u5728 schema \u5C42\u88AB\u62D2\uFF08\u5F85\u5951\u7EA6\u4FEE\u8BA2\uFF09",
      "\u5217\u8868\u8FD4\u56DE\u622A\u65AD + truncated \u6807\u8BB0\uFF0C\u54CD\u5E94\u9884\u7B97 \u2264256KiB\uFF08LIMITS.FRAME_BYTES\uFF09"
    ]
  };
  var BUDGET_BYTES = LIMITS.FRAME_BYTES - 2048;
  var RESOLVED_TYPES = ["BOOLEAN", "FLOAT", "COLOR", "STRING"];
  var STYLE_TYPES = ["PAINT", "TEXT", "EFFECT", "GRID"];
  var STYLE_GETTERS = {
    PAINT: "getLocalPaintStylesAsync",
    TEXT: "getLocalTextStylesAsync",
    EFFECT: "getLocalEffectStylesAsync",
    GRID: "getLocalGridStylesAsync"
  };
  var STYLE_CREATORS = {
    PAINT: "createPaintStyle",
    TEXT: "createTextStyle",
    EFFECT: "createEffectStyle",
    GRID: "createGridStyle"
  };
  var TEXT_CASES2 = ["ORIGINAL", "UPPER", "LOWER", "TITLE", "SMALL_CAPS", "SMALL_CAPS_FORCED"];
  var TEXT_DECORATIONS2 = ["NONE", "UNDERLINE", "STRIKETHROUGH"];
  var EFFECT_TYPES2 = ["DROP_SHADOW", "INNER_SHADOW", "LAYER_BLUR", "BACKGROUND_BLUR"];
  var GRID_PATTERNS = ["GRID", "COLUMNS", "ROWS"];
  var COMPONENT_TYPES = ["COMPONENT", "COMPONENT_SET", "INSTANCE"];
  var PROPERTY_TYPES = ["BOOLEAN", "TEXT", "INSTANCE_SWAP", "VARIANT"];
  var BOUND_NODE_FIELDS = /* @__PURE__ */ new Set([
    "width",
    "height",
    "characters",
    "itemSpacing",
    "paddingLeft",
    "paddingRight",
    "paddingTop",
    "paddingBottom",
    "visible",
    "cornerRadius",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
    "minWidth",
    "maxWidth",
    "minHeight",
    "maxHeight",
    "counterAxisSpacing",
    "strokeWeight",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "opacity",
    "gridRowGap",
    "gridColumnGap"
  ]);
  function requireEditor() {
    if (figma.editorType !== "figma") throw appErr("EDITOR_UNSUPPORTED", "\u8BBE\u8BA1\u7CFB\u7EDF\u547D\u4EE4\u4EC5\u5728 Figma Design \u6587\u4EF6\u4E2D\u53EF\u7528");
  }
  function plain(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function str2(value) {
    return value === void 0 || value === null ? null : String(value).slice(0, 1024);
  }
  function summarizeValue(value, cap = 512) {
    if (value === void 0) return null;
    let json;
    try {
      json = JSON.stringify(value);
    } catch {
      return String(value);
    }
    if (json === void 0 || json.length <= cap) return value;
    return { truncated: true, preview: json.slice(0, cap) };
  }
  function utf8Length2(text) {
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      bytes += code <= 127 ? 1 : code <= 2047 ? 2 : 3;
    }
    return bytes;
  }
  function listEnvelope(items, cap, total) {
    const count = total === void 0 ? items.length : total;
    const data = { ...getContext(), items: items.slice(0, cap), total: count, truncated: count > cap };
    if (utf8Length2(JSON.stringify(data)) <= BUDGET_BYTES) return data;
    while (data.items.length > 1 && utf8Length2(JSON.stringify(data)) > BUDGET_BYTES) {
      data.items.length = Math.max(1, Math.floor(data.items.length / 2));
    }
    data.truncated = true;
    return data;
  }
  function wrapApiError(e, what) {
    if (e && e.code) throw e;
    throw appErr("PLUGIN_ERROR", `${what} \u5931\u8D25: ${e && e.message ? e.message : String(e)}`);
  }
  function validateVariableValue(resolvedType, value) {
    const mismatch = (detail) => appErr("INVALID_PARAM", `value \u4E0E resolvedType=${resolvedType} \u4E0D\u7B26: ${detail}`);
    if (resolvedType === "FLOAT") {
      if (typeof value !== "number" || !Number.isFinite(value)) throw mismatch("\u9700\u8981\u6709\u9650\u6570\u5B57");
      return value;
    }
    if (resolvedType === "BOOLEAN") {
      if (typeof value !== "boolean") throw mismatch("\u9700\u8981\u5E03\u5C14\u503C");
      return value;
    }
    if (resolvedType === "STRING") {
      if (typeof value !== "string") throw mismatch("\u9700\u8981\u5B57\u7B26\u4E32");
      return value;
    }
    if (!isPlainObject2(value)) throw mismatch("\u9700\u8981 {r,g,b,a} \u5BF9\u8C61");
    for (const ch of ["r", "g", "b"]) {
      if (!isFiniteNum(value[ch], 0, 1)) throw mismatch(`color.${ch} \u9700\u5728 [0,1]`);
    }
    if (value.a !== void 0 && !isFiniteNum(value.a, 0, 1)) throw mismatch("color.a \u9700\u5728 [0,1]");
    for (const key of Object.keys(value)) {
      if (!["r", "g", "b", "a"].includes(key)) throw mismatch(`\u4E0D\u652F\u6301 color.${key}`);
    }
    return { r: value.r, g: value.g, b: value.b, ...value.a !== void 0 ? { a: value.a } : {} };
  }
  function variableSummary(variable) {
    const values = {};
    for (const [modeId, value] of Object.entries(variable.valuesByMode || {})) {
      values[modeId] = summarizeValue(cloneValue(value));
    }
    return { id: variable.id, name: str2(variable.name), resolvedType: variable.resolvedType, valuesByMode: values };
  }
  function variableInfo(variable) {
    return {
      ...variableSummary(variable),
      key: variable.key ?? null,
      remote: !!variable.remote,
      variableCollectionId: variable.variableCollectionId ?? null,
      ...typeof variable.description === "string" ? { description: variable.description.slice(0, 2048) } : {}
    };
  }
  async function fetchVariable(variableId, t) {
    requireStr(variableId, "variableId");
    if (typeof figma.variables.getVariableByIdAsync !== "function") {
      throw appErr("UNSUPPORTED", "figma.variables.getVariableByIdAsync \u4E0D\u53EF\u7528");
    }
    const variable = await figma.variables.getVariableByIdAsync(variableId);
    assertTarget(t);
    if (!variable) throw appErr("NODE_NOT_FOUND", `\u627E\u4E0D\u5230\u53D8\u91CF: ${variableId}`);
    return variable;
  }
  async function fetchCollection(collectionId, t) {
    requireStr(collectionId, "collectionId");
    if (typeof figma.variables.getVariableCollectionByIdAsync !== "function") {
      throw appErr("UNSUPPORTED", "figma.variables.getVariableCollectionByIdAsync \u4E0D\u53EF\u7528");
    }
    const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
    assertTarget(t);
    if (!collection) throw appErr("NODE_NOT_FOUND", `\u627E\u4E0D\u5230\u53D8\u91CF\u96C6\u5408: ${collectionId}`);
    return collection;
  }
  async function fetchMode(collection, modeId) {
    const mode = (collection.modes || []).find((m) => m.modeId === modeId);
    if (!mode) throw appErr("NODE_NOT_FOUND", `\u96C6\u5408 ${collection.id} \u4E2D\u627E\u4E0D\u5230\u6A21\u5F0F: ${modeId}`);
    return mode;
  }
  async function handleVariables(p, t) {
    requireEditor();
    onlyKeys(p, ["action", "id", "collectionId", "variableId", "modeId", "field", "name", "resolvedType", "value", "expectedCollectionName"]);
    const variables = figma.variables;
    switch (p.action) {
      case "listCollections": {
        if (typeof variables.getLocalVariableCollectionsAsync !== "function") {
          throw appErr("UNSUPPORTED", "figma.variables.getLocalVariableCollectionsAsync \u4E0D\u53EF\u7528");
        }
        assertTarget(t);
        const collections = await variables.getLocalVariableCollectionsAsync();
        assertTarget(t);
        const items = (collections || []).map((collection) => ({
          id: collection.id,
          name: str2(collection.name),
          remote: !!collection.remote,
          modes: plain(collection.modes || []),
          defaultModeId: collection.defaultModeId ?? null,
          variableIds: (collection.variableIds || []).slice(0, 100),
          variableCount: (collection.variableIds || []).length
        }));
        return listEnvelope(items, 100);
      }
      case "listVariables": {
        const collection = await fetchCollection(p.collectionId, t);
        if (typeof variables.getLocalVariablesAsync !== "function") {
          throw appErr("UNSUPPORTED", "figma.variables.getLocalVariablesAsync \u4E0D\u53EF\u7528");
        }
        const all = await variables.getLocalVariablesAsync();
        assertTarget(t);
        const items = (all || []).filter((v) => v.variableCollectionId === collection.id).map(variableSummary);
        return listEnvelope(items, 200);
      }
      case "getVariable":
        return variableInfo(await fetchVariable(p.variableId, t));
      case "createCollection": {
        onlyKeys(p, ["action", "name"]);
        requireStr(p.name, "name");
        assertTarget(t);
        if (typeof figma.variables?.createVariableCollection !== "function") throw appErr("UNSUPPORTED", "figma.variables.createVariableCollection \u4E0D\u53EF\u7528");
        markMutation(t);
        const collection = figma.variables.createVariableCollection(p.name);
        return {
          collectionId: collection.id,
          name: collection.name,
          modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
          variableIds: []
        };
      }
      case "createVariable": {
        requireStr(p.name, "name");
        requireStr(p.collectionId, "collectionId");
        if (!RESOLVED_TYPES.includes(p.resolvedType)) throw appErr("INVALID_PARAM", `resolvedType \u5FC5\u987B\u662F ${RESOLVED_TYPES.join("/")}`);
        const value = p.value === void 0 ? void 0 : validateVariableValue(p.resolvedType, p.value);
        const collection = await fetchCollection(p.collectionId, t);
        if (collection.remote) throw appErr("INVALID_TARGET", "\u8FDC\u7A0B\uFF08\u5E93\uFF09\u96C6\u5408\u4E0D\u80FD\u521B\u5EFA\u672C\u5730\u53D8\u91CF");
        if (p.expectedCollectionName !== void 0 && String(collection.name) !== p.expectedCollectionName) {
          throw appErr("TARGET_MISMATCH", "\u96C6\u5408\u540D\u79F0\u4E0E\u9884\u671F\u4E0D\u7B26\uFF0C\u5DF2\u62D2\u7EDD\u521B\u5EFA");
        }
        if (typeof variables.createVariable !== "function") throw appErr("UNSUPPORTED", "figma.variables.createVariable \u4E0D\u53EF\u7528");
        assertTarget(t);
        markMutation(t);
        const variable = variables.createVariable(p.name, collection, p.resolvedType);
        if (value !== void 0) variable.setValueForMode(collection.defaultModeId, value);
        return {
          ...variableSummary(variable),
          collectionId: collection.id,
          key: variable.key ?? null,
          ...value !== void 0 ? { defaultValueSet: true } : {}
        };
      }
      case "renameVariable": {
        requireStr(p.name, "name");
        const variable = await fetchVariable(p.variableId, t);
        markMutation(t);
        variable.name = p.name;
        return { id: variable.id, name: variable.name };
      }
      case "deleteVariable": {
        const variable = await fetchVariable(p.variableId, t);
        markMutation(t);
        variable.remove();
        return { id: p.variableId, deleted: true };
      }
      case "setValue": {
        requireStr(p.modeId, "modeId");
        if (!hasOwn(p, "value") || p.value === void 0) throw appErr("INVALID_PARAM", "value \u5FC5\u586B");
        const variable = await fetchVariable(p.variableId, t);
        const collection = await fetchCollection(variable.variableCollectionId, t);
        await fetchMode(collection, p.modeId);
        const value = validateVariableValue(variable.resolvedType, p.value);
        if (typeof variable.setValueForMode !== "function") throw appErr("UNSUPPORTED", "variable.setValueForMode \u4E0D\u53EF\u7528");
        markMutation(t);
        variable.setValueForMode(p.modeId, value);
        return { id: variable.id, modeId: p.modeId, resolvedType: variable.resolvedType, value: summarizeValue(value) };
      }
      case "createMode": {
        requireStr(p.name, "name");
        const collection = await fetchCollection(p.collectionId, t);
        if (typeof collection.addMode !== "function") throw appErr("UNSUPPORTED", "collection.addMode \u4E0D\u53EF\u7528");
        markMutation(t);
        const modeId = collection.addMode(p.name);
        return { collectionId: collection.id, modeId, name: p.name, modes: plain(collection.modes || []) };
      }
      case "renameMode": {
        requireStr(p.name, "name");
        const collection = await fetchCollection(p.collectionId, t);
        await fetchMode(collection, p.modeId);
        if (typeof collection.renameMode !== "function") throw appErr("UNSUPPORTED", "collection.renameMode \u4E0D\u53EF\u7528");
        markMutation(t);
        collection.renameMode(p.modeId, p.name);
        return { collectionId: collection.id, modeId: p.modeId, name: p.name };
      }
      case "deleteMode": {
        const collection = await fetchCollection(p.collectionId, t);
        await fetchMode(collection, p.modeId);
        if (typeof collection.removeMode !== "function") {
          throw appErr("UNSUPPORTED", "\u5F53\u524D Plugin API \u672A\u63D0\u4F9B collection.removeMode\uFF0C\u65E0\u6CD5\u5220\u9664\u6A21\u5F0F");
        }
        if ((collection.modes || []).length <= 1) throw appErr("INVALID_TARGET", "\u96C6\u5408\u81F3\u5C11\u9700\u8981\u4FDD\u7559\u4E00\u4E2A\u6A21\u5F0F");
        markMutation(t);
        collection.removeMode(p.modeId);
        return { collectionId: collection.id, modeId: p.modeId, deleted: true, modes: plain(collection.modes || []) };
      }
      case "resolveValue": {
        const variable = await fetchVariable(p.variableId, t);
        if (!variable.valuesByMode || !hasOwn(variable.valuesByMode, p.modeId)) {
          throw appErr("NODE_NOT_FOUND", `\u53D8\u91CF ${variable.id} \u4E2D\u627E\u4E0D\u5230\u6A21\u5F0F: ${p.modeId}`);
        }
        return {
          id: variable.id,
          modeId: p.modeId,
          resolvedType: variable.resolvedType,
          value: summarizeValue(cloneValue(variable.valuesByMode[p.modeId]))
        };
      }
      case "setBoundVariable": {
        requireStr(p.field, "field");
        const node = await getNode(p.id, t);
        const variable = await fetchVariable(p.variableId, t);
        assertTarget(t);
        markMutation(t, node);
        if (p.field === "fills" || p.field === "strokes") {
          const paints2 = node[p.field];
          if (!Array.isArray(paints2) || paints2.length === 0) throw appErr("INVALID_PARAM", `${p.field} \u4E3A\u7A7A\uFF0C\u65E0\u6CD5\u7ED1\u5B9A\u53D8\u91CF`);
          const bind = variables && typeof variables.setBoundVariableForPaint === "function" ? variables.setBoundVariableForPaint : null;
          if (!bind) throw appErr("UNSUPPORTED", "figma.variables.setBoundVariableForPaint \u4E0D\u53EF\u7528");
          const bound = paints2.map((paint2) => bind(cloneValue(paint2), "color", variable));
          node[p.field] = bound;
          return { nodeId: node.id, field: p.field, variableId: variable.id, via: "setBoundVariableForPaint" };
        }
        if (!BOUND_NODE_FIELDS.has(p.field)) {
          throw appErr("INVALID_PARAM", `field \u5FC5\u987B\u662F fills/strokes \u6216\u8282\u70B9\u53EF\u7ED1\u5B9A\u5B57\u6BB5: ${[...BOUND_NODE_FIELDS].join("/")}`);
        }
        if (typeof node.setBoundVariable !== "function") throw appErr("UNSUPPORTED", "node.setBoundVariable \u4E0D\u53EF\u7528");
        node.setBoundVariable(p.field, variable);
        return { nodeId: node.id, field: p.field, variableId: variable.id, via: "setBoundVariable" };
      }
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5\u53D8\u91CF\u52A8\u4F5C: ${p.action}`);
    }
  }
  function cloneArrayField(value, name) {
    if (!Array.isArray(value)) throw appErr("INVALID_PARAM", `${name} \u5FC5\u987B\u662F\u6570\u7EC4`);
    return plain(value);
  }
  function validateEffects2(effects) {
    if (!Array.isArray(effects)) throw appErr("INVALID_PARAM", "props.effects \u5FC5\u987B\u662F\u6570\u7EC4");
    if (effects.length > 32) throw appErr("INVALID_PARAM", "props.effects \u6570\u91CF\u8D85\u8FC7 32");
    return effects.map((effect) => {
      if (!isPlainObject2(effect)) throw appErr("INVALID_PARAM", "props.effects \u5143\u7D20\u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      if (!EFFECT_TYPES2.includes(effect.type)) {
        throw appErr("INVALID_PARAM", `props.effects.type \u5FC5\u987B\u662F ${EFFECT_TYPES2.join("/")}`);
      }
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        if (!isPlainObject2(effect.color)) throw appErr("INVALID_PARAM", "\u9634\u5F71 effect \u9700\u8981 color");
        for (const ch of ["r", "g", "b"]) {
          if (!isFiniteNum(effect.color[ch], 0, 1)) throw appErr("INVALID_PARAM", `effect.color.${ch} \u9700\u5728 [0,1]`);
        }
        if (effect.color.a !== void 0 && !isFiniteNum(effect.color.a, 0, 1)) throw appErr("INVALID_PARAM", "effect.color.a \u9700\u5728 [0,1]");
        if (!isPlainObject2(effect.offset) || !isFiniteNum(effect.offset.x, -1e6, 1e6) || !isFiniteNum(effect.offset.y, -1e6, 1e6)) {
          throw appErr("INVALID_PARAM", "\u9634\u5F71 effect \u9700\u8981 offset {x,y}");
        }
        if (!isFiniteNum(effect.radius, 0, 1e5)) throw appErr("INVALID_PARAM", "effect.radius \u9700\u5728 [0,1e5]");
      } else if (!isFiniteNum(effect.radius, 0, 1e5)) {
        throw appErr("INVALID_PARAM", "\u6A21\u7CCA effect \u9700\u8981 radius \u2208 [0,1e5]");
      }
      return plain(effect);
    });
  }
  function validateLayoutGrids(grids) {
    if (!Array.isArray(grids)) throw appErr("INVALID_PARAM", "props.layoutGrids \u5FC5\u987B\u662F\u6570\u7EC4");
    if (grids.length > 16) throw appErr("INVALID_PARAM", "props.layoutGrids \u6570\u91CF\u8D85\u8FC7 16");
    return grids.map((grid) => {
      if (!isPlainObject2(grid)) throw appErr("INVALID_PARAM", "props.layoutGrids \u5143\u7D20\u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      if (grid.pattern !== void 0 && !GRID_PATTERNS.includes(grid.pattern)) {
        throw appErr("INVALID_PARAM", `layoutGrids.pattern \u5FC5\u987B\u662F ${GRID_PATTERNS.join("/")}`);
      }
      return plain(grid);
    });
  }
  async function applyTextProps(style, props) {
    if (props.fontName !== void 0) {
      const font = props.fontName;
      if (!isPlainObject2(font) || typeof font.family !== "string" || typeof font.style !== "string") {
        throw appErr("INVALID_PARAM", "props.fontName \u9700\u8981 {family, style}");
      }
      await figma.loadFontAsync({ family: font.family, style: font.style });
      style.fontName = { family: font.family, style: font.style };
    }
    if (props.fontSize !== void 0) style.fontSize = requireNum(props.fontSize, "props.fontSize", 1, 1e3);
    if (props.lineHeight !== void 0) style.lineHeight = { unit: "PIXELS", value: requireNum(props.lineHeight, "props.lineHeight", 0, 1e5) };
    if (props.letterSpacing !== void 0) style.letterSpacing = { unit: "PIXELS", value: requireNum(props.letterSpacing, "props.letterSpacing", -1e5, 1e5) };
    if (props.textCase !== void 0) {
      if (!TEXT_CASES2.includes(props.textCase)) throw appErr("INVALID_PARAM", `props.textCase \u5FC5\u987B\u662F ${TEXT_CASES2.join("/")}`);
      style.textCase = props.textCase;
    }
    if (props.textDecoration !== void 0) {
      if (!TEXT_DECORATIONS2.includes(props.textDecoration)) throw appErr("INVALID_PARAM", `props.textDecoration \u5FC5\u987B\u662F ${TEXT_DECORATIONS2.join("/")}`);
      style.textDecoration = props.textDecoration;
    }
    if (props.paragraphSpacing !== void 0) style.paragraphSpacing = requireNum(props.paragraphSpacing, "props.paragraphSpacing", 0, 1e5);
  }
  async function applyStyleProps(style, styleType, props) {
    if (styleType === "PAINT" && props.paints !== void 0) style.paints = validatePaints(props.paints, "props.paints");
    if (styleType === "TEXT") await applyTextProps(style, props);
    if (styleType === "EFFECT" && props.effects !== void 0) style.effects = validateEffects2(props.effects);
    if (styleType === "GRID" && props.layoutGrids !== void 0) style.layoutGrids = validateLayoutGrids(props.layoutGrids);
  }
  async function fetchStyleType(styleType) {
    if (!STYLE_TYPES.includes(styleType)) throw appErr("INVALID_PARAM", `styleType \u5FC5\u987B\u662F ${STYLE_TYPES.join("/")}`);
    const getter = STYLE_GETTERS[styleType];
    if (typeof figma[getter] !== "function") throw appErr("UNSUPPORTED", `figma.${getter} \u4E0D\u53EF\u7528`);
    return getter;
  }
  async function fetchStyles(styleType, t) {
    const getter = await fetchStyleType(styleType);
    const styles = await figma[getter]();
    assertTarget(t);
    return styles || [];
  }
  async function fetchStyle(styleType, styleId, t) {
    requireStr(styleId, "styleId");
    const styles = await fetchStyles(styleType, t);
    const style = styles.find((s) => s.id === styleId);
    if (!style) throw appErr("STYLE_NOT_FOUND", `\u627E\u4E0D\u5230 ${styleType} \u6837\u5F0F: ${styleId}`);
    return style;
  }
  function styleInfo(style, styleType) {
    const info = {
      id: style.id,
      name: str2(style.name),
      styleType,
      key: style.key ?? null,
      description: typeof style.description === "string" ? style.description.slice(0, 2048) : null,
      remote: !!style.remote
    };
    if (styleType === "PAINT") {
      if (style.paints !== void 0) info.paints = cloneArrayField(style.paints, "style.paints");
    } else if (styleType === "TEXT") {
      for (const key of ["fontName", "fontSize", "lineHeight", "letterSpacing", "textCase", "textDecoration", "paragraphSpacing"]) {
        if (style[key] !== void 0) info[key] = cloneValue(style[key]);
      }
    } else if (styleType === "EFFECT") {
      if (style.effects !== void 0) info.effects = cloneArrayField(style.effects, "style.effects");
    } else if (styleType === "GRID") {
      if (style.layoutGrids !== void 0) info.layoutGrids = cloneArrayField(style.layoutGrids, "style.layoutGrids");
    }
    return info;
  }
  async function handleStyles(p, t) {
    requireEditor();
    onlyKeys(p, ["action", "id", "styleType", "styleId", "name", "props"]);
    const props = p.props === void 0 ? {} : p.props;
    switch (p.action) {
      case "list": {
        const styles = await fetchStyles(p.styleType, t);
        const items = styles.map((style) => styleInfo(style, p.styleType));
        return listEnvelope(items, 200);
      }
      case "get":
        return styleInfo(await fetchStyle(p.styleType, p.styleId, t), p.styleType);
      case "create": {
        requireStr(p.name, "name");
        if (!STYLE_TYPES.includes(p.styleType)) throw appErr("INVALID_PARAM", `styleType \u5FC5\u987B\u662F ${STYLE_TYPES.join("/")}`);
        const creator = STYLE_CREATORS[p.styleType];
        if (typeof figma[creator] !== "function") throw appErr("UNSUPPORTED", `figma.${creator} \u4E0D\u53EF\u7528`);
        assertTarget(t);
        markMutation(t);
        const style = figma[creator]();
        style.name = p.name;
        await applyStyleProps(style, p.styleType, props);
        return styleInfo(style, p.styleType);
      }
      case "update": {
        const style = await fetchStyle(p.styleType, p.styleId, t);
        if (p.name !== void 0) style.name = requireStr(p.name, "name");
        await applyStyleProps(style, p.styleType, props);
        markMutation(t);
        return styleInfo(style, p.styleType);
      }
      case "apply": {
        const node = await getNode(p.id, t);
        const style = await fetchStyle(p.styleType, p.styleId, t);
        assertTarget(t);
        const cap = { PAINT: "Fill", TEXT: "Text", EFFECT: "Effect", GRID: "Grid" }[p.styleType];
        const asyncSetter = node[`set${cap}StyleIdAsync`];
        let appliedVia;
        if (typeof asyncSetter === "function") {
          await asyncSetter.call(node, style.id);
          appliedVia = `set${cap}StyleIdAsync`;
        } else {
          node[`${cap.toLowerCase()}StyleId`] = style.id;
          appliedVia = `${cap.toLowerCase()}StyleId`;
        }
        markMutation(t, node);
        return { nodeId: node.id, styleId: style.id, styleType: p.styleType, appliedVia };
      }
      case "delete": {
        const style = await fetchStyle(p.styleType, p.styleId, t);
        markMutation(t);
        style.remove();
        return { styleId: p.styleId, styleType: p.styleType, deleted: true };
      }
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5\u6837\u5F0F\u52A8\u4F5C: ${p.action}`);
    }
  }
  async function mainComponentOf(instance) {
    try {
      if (typeof instance.getMainComponentAsync === "function") return await instance.getMainComponentAsync();
    } catch (e) {
    }
    try {
      return instance.mainComponent || null;
    } catch {
      return null;
    }
  }
  async function handleComponents(p, t) {
    requireEditor();
    onlyKeys(p, [
      "action",
      "id",
      "componentId",
      "instanceId",
      "parentId",
      "x",
      "y",
      "name",
      "propertyName",
      "propertyType",
      "value",
      "defaultValue",
      "variantOptions",
      "description",
      "nodeIds"
    ]);
    switch (p.action) {
      case "list": {
        assertTarget(t);
        if (typeof figma.currentPage.findAll !== "function") throw appErr("UNSUPPORTED", "currentPage.findAll \u4E0D\u53EF\u7528");
        const found = figma.currentPage.findAll((node) => COMPONENT_TYPES.includes(node.type)) || [];
        const items = [];
        for (const node of found) {
          const item = { id: node.id, type: node.type, name: str2(node.name), key: node.key ?? null };
          if (node.type === "INSTANCE") {
            const main = await mainComponentOf(node);
            item.componentId = main ? main.id : null;
          }
          if (node.variantProperties !== void 0) item.variantProperties = plain(node.variantProperties);
          items.push(item);
          if (items.length >= 500) break;
        }
        return listEnvelope(items, 500, found.length);
      }
      case "createFromNode": {
        const node = await getNode(p.id, t);
        if (["COMPONENT", "COMPONENT_SET"].includes(node.type)) {
          throw appErr("INVALID_TARGET", "\u7EC4\u4EF6/\u7EC4\u4EF6\u96C6\u4E0D\u80FD\u518D\u8F6C\u4E3A\u7EC4\u4EF6");
        }
        if (typeof figma.createComponentFromNode !== "function") throw appErr("UNSUPPORTED", "figma.createComponentFromNode \u4E0D\u53EF\u7528");
        assertTarget(t);
        markMutation(t, node);
        const component = figma.createComponentFromNode(node);
        markMutation(t, component);
        return { componentId: component.id, name: str2(component.name), childId: node.id };
      }
      case "createInstance": {
        const component = await getNode(p.componentId, t);
        if (component.type !== "COMPONENT") throw appErr("INVALID_TARGET", "componentId \u5FC5\u987B\u662F COMPONENT \u8282\u70B9");
        if (typeof component.createInstance !== "function") throw appErr("UNSUPPORTED", "component.createInstance \u4E0D\u53EF\u7528");
        assertTarget(t);
        const instance = component.createInstance();
        if (p.x !== void 0) instance.x = requireNum(p.x, "x", -1e6, 1e6);
        if (p.y !== void 0) instance.y = requireNum(p.y, "y", -1e6, 1e6);
        let parent = figma.currentPage;
        if (p.parentId !== void 0) {
          parent = p.parentId === figma.currentPage.id ? figma.currentPage : await getNode(p.parentId, t);
          if (!["PAGE", "FRAME", "COMPONENT", "COMPONENT_SET", "GROUP", "SECTION"].includes(parent.type)) {
            throw appErr("INVALID_TARGET", "parentId \u5FC5\u987B\u662F\u5BB9\u5668\u8282\u70B9");
          }
        }
        parent.appendChild(instance);
        markMutation(t, instance);
        return { id: instance.id, componentId: component.id, parentId: parent.id };
      }
      case "combineAsVariants": {
        const nodeIds = p.nodeIds;
        if (!Array.isArray(nodeIds) || nodeIds.length < 2 || nodeIds.length > 64) {
          throw appErr("INVALID_PARAM", "nodeIds \u5FC5\u987B\u662F 2..64 \u4E2A\u8282\u70B9 id\uFF08\u5F53\u524D\u5171\u4EAB\u6CE8\u518C\u8868\u6682\u672A\u5F00\u653E\u8BE5\u5B57\u6BB5\uFF09");
        }
        const nodes = [];
        for (const nodeId of nodeIds) {
          const node = await getNode(nodeId, t);
          if (node.type !== "COMPONENT") throw appErr("INVALID_TARGET", `combineAsVariants \u4EC5\u652F\u6301 COMPONENT \u8282\u70B9: ${nodeId}`);
          nodes.push(node);
        }
        if (typeof figma.combineAsVariants !== "function") throw appErr("UNSUPPORTED", "figma.combineAsVariants \u4E0D\u53EF\u7528");
        assertTarget(t);
        markMutation(t, nodes[0]);
        const set = figma.combineAsVariants(nodes, figma.currentPage);
        markMutation(t, set);
        return { componentSetId: set.id, memberIds: nodes.map((node) => node.id) };
      }
      case "swap": {
        const instance = await getNode(p.instanceId, t);
        if (instance.type !== "INSTANCE") throw appErr("INVALID_TARGET", "instanceId \u5FC5\u987B\u662F INSTANCE \u8282\u70B9");
        const component = await getNode(p.componentId, t);
        if (component.type !== "COMPONENT") throw appErr("INVALID_TARGET", "componentId \u5FC5\u987B\u662F COMPONENT \u8282\u70B9");
        if (typeof instance.swapComponent !== "function") throw appErr("UNSUPPORTED", "instance.swapComponent \u4E0D\u53EF\u7528");
        markMutation(t, instance);
        instance.swapComponent(component);
        return { id: instance.id, componentId: component.id };
      }
      case "detach": {
        const instance = await getNode(p.instanceId, t);
        if (instance.type !== "INSTANCE") throw appErr("INVALID_TARGET", "instanceId \u5FC5\u987B\u662F INSTANCE \u8282\u70B9");
        if (typeof instance.detachInstance !== "function") throw appErr("UNSUPPORTED", "instance.detachInstance \u4E0D\u53EF\u7528");
        assertTarget(t);
        const frame = instance.detachInstance();
        markMutation(t, frame);
        t.affected.push(instance.id);
        return { id: frame.id, type: frame.type, fromInstanceId: instance.id };
      }
      case "getInstanceInfo": {
        const instance = await getNode(p.instanceId, t);
        if (instance.type !== "INSTANCE") throw appErr("INVALID_TARGET", "instanceId \u5FC5\u987B\u662F INSTANCE \u8282\u70B9");
        const main = await mainComponentOf(instance);
        const info = {
          id: instance.id,
          componentId: main ? main.id : null,
          componentKey: main && main.key !== void 0 ? main.key : null,
          componentProperties: plain(instance.componentProperties || {})
        };
        if (instance.variantProperties !== void 0) info.variantProperties = plain(instance.variantProperties);
        return info;
      }
      case "setInstanceProperty": {
        const instance = await getNode(p.instanceId, t);
        if (instance.type !== "INSTANCE") throw appErr("INVALID_TARGET", "instanceId \u5FC5\u987B\u662F INSTANCE \u8282\u70B9");
        requireStr(p.propertyName, "propertyName");
        if (!hasOwn(p, "value")) throw appErr("INVALID_PARAM", "value \u5FC5\u586B");
        if (typeof instance.setProperties !== "function") throw appErr("UNSUPPORTED", "instance.setProperties \u4E0D\u53EF\u7528");
        markMutation(t, instance);
        instance.setProperties({ [p.propertyName]: p.value });
        return { id: instance.id, propertyName: p.propertyName, value: p.value === void 0 ? null : p.value };
      }
      case "addComponentProperty": {
        const component = await getNode(p.componentId, t);
        if (!["COMPONENT", "COMPONENT_SET"].includes(component.type)) {
          throw appErr("INVALID_TARGET", "componentId \u5FC5\u987B\u662F COMPONENT \u6216 COMPONENT_SET \u8282\u70B9");
        }
        requireStr(p.propertyName, "propertyName");
        if (!PROPERTY_TYPES.includes(p.propertyType)) throw appErr("INVALID_PARAM", `propertyType \u5FC5\u987B\u662F ${PROPERTY_TYPES.join("/")}`);
        if (!hasOwn(p, "defaultValue")) throw appErr("INVALID_PARAM", "defaultValue \u5FC5\u586B");
        if (p.propertyType === "BOOLEAN") requireBool(p.defaultValue, "defaultValue");
        else if (typeof p.defaultValue !== "string") throw appErr("INVALID_PARAM", `${p.propertyType} \u5C5E\u6027\u7684 defaultValue \u5FC5\u987B\u662F\u5B57\u7B26\u4E32`);
        if (typeof component.addComponentProperty !== "function") throw appErr("UNSUPPORTED", "component.addComponentProperty \u4E0D\u53EF\u7528");
        markMutation(t, component);
        const propertyName = component.addComponentProperty(p.propertyName, p.propertyType, p.defaultValue);
        return { componentId: component.id, propertyName, propertyType: p.propertyType, defaultValue: p.defaultValue };
      }
      case "editComponentProperty": {
        const component = await getNode(p.componentId, t);
        if (!["COMPONENT", "COMPONENT_SET"].includes(component.type)) {
          throw appErr("INVALID_TARGET", "componentId \u5FC5\u987B\u662F COMPONENT \u6216 COMPONENT_SET \u8282\u70B9");
        }
        requireStr(p.propertyName, "propertyName");
        const patch = {};
        if (p.name !== void 0) patch.name = requireStr(p.name, "name");
        if (hasOwn(p, "defaultValue") && p.defaultValue !== void 0) {
          if (typeof p.defaultValue !== "boolean" && typeof p.defaultValue !== "string") {
            throw appErr("INVALID_PARAM", "defaultValue \u5FC5\u987B\u662F\u5E03\u5C14\u503C\u6216\u5B57\u7B26\u4E32");
          }
          patch.defaultValue = p.defaultValue;
        }
        if (p.description !== void 0) patch.description = String(p.description);
        if (Object.keys(patch).length === 0) throw appErr("INVALID_PARAM", "editComponentProperty \u9700\u8981 name/defaultValue/description \u4E4B\u4E00");
        if (typeof component.editComponentProperty !== "function") throw appErr("UNSUPPORTED", "component.editComponentProperty \u4E0D\u53EF\u7528");
        markMutation(t, component);
        const propertyName = component.editComponentProperty(p.propertyName, patch);
        return { componentId: component.id, propertyName, ...patch };
      }
      case "deleteComponentProperty": {
        const component = await getNode(p.componentId, t);
        if (!["COMPONENT", "COMPONENT_SET"].includes(component.type)) {
          throw appErr("INVALID_TARGET", "componentId \u5FC5\u987B\u662F COMPONENT \u6216 COMPONENT_SET \u8282\u70B9");
        }
        requireStr(p.propertyName, "propertyName");
        if (typeof component.deleteComponentProperty !== "function") throw appErr("UNSUPPORTED", "component.deleteComponentProperty \u4E0D\u53EF\u7528");
        markMutation(t, component);
        component.deleteComponentProperty(p.propertyName);
        return { componentId: component.id, propertyName: p.propertyName, deleted: true };
      }
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5\u7EC4\u4EF6\u52A8\u4F5C: ${p.action}`);
    }
  }
  function teamLibraryApi() {
    const library = figma.teamLibrary;
    if (!library || typeof library !== "object") {
      throw appErr("UNSUPPORTED", 'figma.teamLibrary \u4E0D\u53EF\u7528\uFF1Amanifest permissions \u9700\u58F0\u660E "teamlibrary"');
    }
    return library;
  }
  async function handleLibraries(p, t) {
    requireEditor();
    onlyKeys(p, ["action", "collectionKey", "variableKey", "componentKey", "styleKey"]);
    switch (p.action) {
      case "listCollections": {
        const library = teamLibraryApi();
        if (typeof library.getAvailableLibraryVariableCollectionsAsync !== "function") {
          throw appErr("UNSUPPORTED", "figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync \u4E0D\u53EF\u7528");
        }
        let collections;
        try {
          collections = await library.getAvailableLibraryVariableCollectionsAsync();
        } catch (e) {
          wrapApiError(e, "getAvailableLibraryVariableCollectionsAsync");
        }
        assertTarget(t);
        const items = (collections || []).map((collection) => ({
          id: collection.id ?? null,
          name: str2(collection.name),
          key: collection.key ?? null
        }));
        return listEnvelope(items, 100);
      }
      case "listVariables": {
        requireStr(p.collectionKey, "collectionKey");
        const library = teamLibraryApi();
        if (typeof library.getVariablesInLibraryCollectionAsync !== "function") {
          throw appErr("UNSUPPORTED", "figma.teamLibrary.getVariablesInLibraryCollectionAsync \u4E0D\u53EF\u7528");
        }
        let variables;
        try {
          variables = await library.getVariablesInLibraryCollectionAsync(p.collectionKey);
        } catch (e) {
          wrapApiError(e, "getVariablesInLibraryCollectionAsync");
        }
        assertTarget(t);
        const items = (variables || []).map((variable) => ({
          id: variable.id ?? null,
          variableId: variable.variableId ?? null,
          key: variable.key ?? null,
          name: str2(variable.name),
          resolvedType: variable.resolvedType ?? null,
          ...typeof variable.description === "string" ? { description: variable.description.slice(0, 2048) } : {}
        }));
        return listEnvelope(items, 200);
      }
      case "importVariable": {
        requireStr(p.variableKey, "variableKey");
        if (typeof figma.variables.importVariableByKeyAsync !== "function") {
          throw appErr("UNSUPPORTED", "figma.variables.importVariableByKeyAsync \u4E0D\u53EF\u7528");
        }
        let variable;
        try {
          variable = await figma.variables.importVariableByKeyAsync(p.variableKey);
        } catch (e) {
          wrapApiError(e, "importVariableByKeyAsync");
        }
        assertTarget(t);
        markMutation(t);
        return { ...variableInfo(variable), imported: true };
      }
      case "importComponent": {
        requireStr(p.componentKey, "componentKey");
        if (typeof figma.importComponentByKeyAsync !== "function") throw appErr("UNSUPPORTED", "figma.importComponentByKeyAsync \u4E0D\u53EF\u7528");
        let component;
        try {
          component = await figma.importComponentByKeyAsync(p.componentKey);
        } catch (e) {
          wrapApiError(e, "importComponentByKeyAsync");
        }
        assertTarget(t);
        markMutation(t);
        return { id: component.id, type: component.type, name: str2(component.name), key: component.key ?? null, imported: true };
      }
      case "importStyle": {
        requireStr(p.styleKey, "styleKey");
        if (typeof figma.importStyleByKeyAsync !== "function") throw appErr("UNSUPPORTED", "figma.importStyleByKeyAsync \u4E0D\u53EF\u7528");
        let style;
        try {
          style = await figma.importStyleByKeyAsync(p.styleKey);
        } catch (e) {
          wrapApiError(e, "importStyleByKeyAsync");
        }
        assertTarget(t);
        markMutation(t);
        const styleType = STYLE_TYPES.includes(style.type) ? style.type : "PAINT";
        return { ...styleInfo(style, styleType), imported: true };
      }
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5\u5E93\u52A8\u4F5C: ${p.action}`);
    }
  }
  var handlers11 = {
    variables: handleVariables,
    styles: handleStyles,
    components: handleComponents,
    libraries: handleLibraries
  };

  // plugin/src/prototype.js
  var domainMeta9 = {
    name: "prototype",
    actions: ["set", "clear"],
    notes: ["\u5173\u952E\u5BFC\u822A\u4E0E\u8FD4\u56DE\u987B\u5B9E\u9645\u70B9\u51FB\u9A8C\u6536\uFF08\u771F\u673A\uFF09"]
  };
  var TRIGGER_TYPES = /* @__PURE__ */ new Set([
    "ON_CLICK",
    "ON_HOVER",
    "ON_PRESS",
    "ON_DRAG",
    "AFTER_TIMEOUT",
    "MOUSE_ENTER",
    "MOUSE_LEAVE",
    "MOUSE_UP",
    "MOUSE_DOWN"
  ]);
  var ACTION_TYPES = /* @__PURE__ */ new Set([
    "BACK",
    "CLOSE",
    "URL",
    "OPEN_LINK",
    "UPDATE_MEDIA_RUNTIME",
    "SET_VARIABLE",
    "SET_VARIABLE_MODE",
    "CONDITIONAL",
    "NODE"
  ]);
  var ACTION_KEYS = [
    "destinationId",
    "navigation",
    "transition",
    "url",
    "preserveScrollPosition",
    "overlayRelativePosition"
  ];
  var MAX_REACTIONS = 64;
  function normalizeReaction(raw, index) {
    const label = `reactions[${index}]`;
    if (!isPlainObject2(raw) || !isPlainObject2(raw.trigger) || !isPlainObject2(raw.action)) {
      throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F {trigger, action} \u7ED3\u6784`);
    }
    const triggerType = raw.trigger.type;
    if (!TRIGGER_TYPES.has(triggerType)) throw appErr("INVALID_PARAM", `${label}.trigger.type \u975E\u6CD5: ${triggerType}`);
    if (triggerType === "AFTER_TIMEOUT") {
      const timeout = raw.trigger.timeout;
      if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 1) {
        throw appErr("INVALID_PARAM", `${label}: AFTER_TIMEOUT \u89E6\u53D1\u5668\u9700\u8981 >=1 \u7684 timeout`);
      }
    }
    const actionType = raw.action.type;
    if (!ACTION_TYPES.has(actionType)) throw appErr("INVALID_PARAM", `${label}.action.type \u975E\u6CD5: ${actionType}`);
    if (actionType === "URL" || actionType === "OPEN_LINK") {
      if (typeof raw.action.url !== "string" || !/^https?:\/\//i.test(raw.action.url)) {
        throw appErr("INVALID_PARAM", `${label}.action.url \u5FC5\u987B\u662F http/https \u5730\u5740`);
      }
    }
    const navigation = raw.action.navigation;
    if ((actionType === "NAVIGATE" || navigation === "SWAP") && (typeof raw.action.destinationId !== "string" || !raw.action.destinationId.length)) {
      throw appErr("INVALID_PARAM", `${label}: ${actionType === "NAVIGATE" ? "NAVIGATE" : "SWAP"} \u52A8\u4F5C\u5FC5\u987B\u6709 destinationId`);
    }
    const trigger = { type: triggerType };
    if (raw.trigger.timeout !== void 0) trigger.timeout = raw.trigger.timeout;
    const action = { type: actionType };
    for (const key of ACTION_KEYS) {
      if (raw.action[key] !== void 0) action[key] = raw.action[key];
    }
    return { trigger, action };
  }
  async function assertDestination(id, t, label) {
    try {
      await getNode(id, t);
    } catch (e) {
      if (e && e.code === "NODE_NOT_FOUND") {
        throw appErr("INVALID_TARGET", `${label} \u5BFC\u822A\u76EE\u6807\u4E0D\u5B58\u5728: ${id}`);
      }
      throw e;
    }
  }
  async function handleSetReactions(p, t) {
    onlyKeys(p, ["action", "id", "reactions", "prototypeStartNodeId"]);
    if (p.action !== "set" && p.action !== "clear") throw appErr("INVALID_PARAM", "action \u5FC5\u987B\u662F set \u6216 clear");
    const node = await getNode(p.id, t);
    let reactions = [];
    if (p.action === "set") {
      if (!Array.isArray(p.reactions)) throw appErr("INVALID_PARAM", "set \u9700\u8981 reactions \u6570\u7EC4");
      if (p.reactions.length > MAX_REACTIONS) throw appErr("INVALID_PARAM", `reactions \u6570\u91CF\u8D85\u8FC7 ${MAX_REACTIONS}`);
      reactions = p.reactions.map(normalizeReaction);
      for (let i = 0; i < reactions.length; i++) {
        const destinationId = reactions[i].action.destinationId;
        if (destinationId) await assertDestination(destinationId, t, `reactions[${i}]`);
      }
    }
    let startNode = null;
    const touchesStartNode = p.prototypeStartNodeId !== void 0;
    if (touchesStartNode && p.prototypeStartNodeId !== null) {
      startNode = await getNode(p.prototypeStartNodeId, t);
    }
    assertTarget(t);
    markMutation(t, node);
    if (touchesStartNode && startNode) markMutation(t, startNode);
    try {
      if (typeof node.setReactionsAsync === "function") {
        const apiReactions = reactions.map((reaction) => ({ trigger: reaction.trigger, actions: [reaction.action] }));
        await node.setReactionsAsync(apiReactions);
      } else node.reactions = reactions;
      if (touchesStartNode) figma.currentPage.prototypeStartNode = startNode;
    } catch (e) {
      if (e && e.code) throw e;
      throw appErr("REACTION_WRITE_FAILED", "\u5199\u5165 reactions \u5931\u8D25: " + (e && e.message ? e.message : String(e)));
    }
    assertTarget(t);
    const pageStart = figma.currentPage.prototypeStartNode;
    return {
      id: node.id,
      reactions: cloneValue(node.reactions),
      reactionsCount: Array.isArray(node.reactions) ? node.reactions.length : 0,
      prototypeStartNodeId: pageStart && pageStart.id ? pageStart.id : null
    };
  }
  var handlers12 = {
    setReactions: handleSetReactions
  };

  // plugin/src/batch.js
  var REF = /^step(\d+)\.id$/;
  function collectRefs(params, out = []) {
    if (typeof params === "string") {
      const match = params.match(REF);
      if (match) out.push(Number(match[1]));
    } else if (Array.isArray(params)) {
      for (const item of params) collectRefs(item, out);
    } else if (isPlainObject2(params)) {
      for (const key of Object.keys(params)) collectRefs(params[key], out);
    }
    return out;
  }
  function substituteRefs(params, results) {
    if (typeof params === "string") {
      const match = params.match(REF);
      if (match) {
        const step = results[Number(match[1])];
        if (!step || typeof step.id !== "string") throw appErr("BATCH_REF", `\u5F15\u7528 step${match[1]}.id \u4E0D\u53EF\u7528`);
        return step.id;
      }
      return params;
    }
    if (Array.isArray(params)) return params.map((item) => substituteRefs(item, results));
    if (isPlainObject2(params)) {
      const out = {};
      for (const key of Object.keys(params)) out[key] = substituteRefs(params[key], results);
      return out;
    }
    return params;
  }
  async function handleBatch(p, t) {
    if (!Array.isArray(p.steps) || p.steps.length < 1 || p.steps.length > LIMITS.BATCH_STEPS) {
      throw appErr("INVALID_PARAM", `steps \u6570\u91CF\u5FC5\u987B\u5728 1\u2013${LIMITS.BATCH_STEPS}`);
    }
    const plans = p.steps.map((step, index) => {
      if (!isPlainObject2(step) || typeof step.command !== "string" || !isPlainObject2(step.params)) {
        throw appErr("INVALID_PARAM", `step${index} \u5FC5\u987B\u662F {command, params}`);
      }
      if (BATCH_EXCLUDED_COMMANDS.has(step.command) || step.command === "batch") {
        throw appErr("BATCH_FORBIDDEN", `${step.command} \u4E0D\u80FD\u653E\u5165 batch`);
      }
      if (!Object.prototype.hasOwnProperty.call(HANDLERS, step.command)) {
        throw appErr("BATCH_FORBIDDEN", `\u672A\u77E5\u547D\u4EE4: ${step.command}`);
      }
      const refs = collectRefs(step.params);
      for (const ref of refs) if (ref >= index || ref < 0) throw appErr("BATCH_REF", `step${index} \u5F15\u7528\u4E0D\u5B58\u5728\u7684 step${ref}`);
      const schema = pluginSchemaFor(step.command);
      if (schema) {
        try {
          validateSchema(step.params, schema);
        } catch (e) {
          throw appErr("INVALID_PARAM", `step${index} \u53C2\u6570\u4E0D\u5408\u6CD5: ${e.message}`);
        }
      }
      return step;
    });
    const results = [];
    const stepResults = [];
    for (let index = 0; index < plans.length; index++) {
      const step = plans[index];
      try {
        assertTarget(t);
        const params = substituteRefs(step.params, stepResults);
        const data = await HANDLERS[step.command](params, t, { operationId: null });
        stepResults.push(data);
        results.push({ step: index, command: step.command, status: "succeeded", data });
      } catch (e) {
        results.push({
          step: index,
          command: step.command,
          status: "failed",
          error: { code: e.code || "PLUGIN_ERROR", message: e.message || String(e) }
        });
        if (p.continueOnError !== true) {
          for (let rest = index + 1; rest < plans.length; rest++) {
            results.push({ step: rest, command: plans[rest].command, status: "not_started" });
          }
          throw Object.assign(appErr("BATCH_STOPPED", `step${index} \u5931\u8D25\uFF0Cbatch \u5DF2\u505C\u6B62`), { state: "failed", batchResults: results });
        }
      }
    }
    return { steps: results, affectedNodeIds: t.affected };
  }

  // plugin/src/motion.js
  var domainMeta10 = {
    name: "motion",
    actions: ["listAnimationStyles", "readNode", "applyStyle", "removeStyle", "applyTrack", "removeTrack", "setDuration", "shaders"],
    preconditions: ["Motion/MP4 \u9700\u5BF9\u5E94\u8FD0\u884C\u65F6 API \u4E0E\u5E26\u52A8\u753B\u9876\u5C42 Frame \u6837\u672C"],
    notes: ["\u672A\u5BFC\u5165\u7684 Shader \u5C5E\u6027\u53EF\u80FD\u4E0D\u53EF\u8BFB\uFF0C\u8FD4\u56DE\u4E0D\u53EF\u5F97\u539F\u56E0\uFF0C\u4E0D\u9690\u5F0F\u5BFC\u5165", "shaders \u5206\u9875\u4E3A\u504F\u79FB\u5F0F\uFF0C\u4E0D\u56FA\u5B9A\u6210\u5458\u5217\u8868"]
  };
  var FIELD_TYPES = /* @__PURE__ */ new Set(["PROPERTY", "PAINT", "EFFECT"]);
  var MOTION_PROPS = ["animations", "manualKeyframeTracks", "timelines", "animationStyles"];
  var STYLE_LIMIT = 200;
  var SHADER_PAGE_SIZE = 100;
  var MAX_KEYFRAMES = 512;
  function jsonSafe(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return null;
    }
  }
  function requireId(p) {
    return requireStr(p.id, "id");
  }
  function readProp(node, key) {
    if (!(key in node)) return null;
    try {
      const value = cloneValue(node[key]);
      return value === void 0 ? null : value;
    } catch {
      return null;
    }
  }
  function motionApi() {
    if (!figma.motion || typeof figma.motion.figmaAnimationStyles !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 Motion API");
    }
    return figma.motion.figmaAnimationStyles.bind(figma.motion);
  }
  async function listAnimationStyles(t) {
    const api = motionApi();
    const raw = await api();
    assertTarget(t);
    const list = Array.isArray(raw) ? raw : [];
    const styles = [];
    for (const item of list.slice(0, STYLE_LIMIT)) {
      const safe = jsonSafe(item);
      if (safe && isPlainObject2(safe)) {
        styles.push({ id: safe.id !== void 0 ? safe.id : null, ...safe });
      }
    }
    return { styles, total: list.length };
  }
  async function readMotionNode(p, t) {
    const node = await getNode(requireId(p), t);
    assertTarget(t);
    const out = { id: node.id };
    const unsupported = [];
    for (const key of MOTION_PROPS) {
      if (!(key in node)) {
        out[key] = null;
        unsupported.push(key);
        continue;
      }
      try {
        const value = cloneValue(node[key]);
        if (value === void 0) throw new Error("unreadable");
        out[key] = value;
      } catch {
        out[key] = null;
        unsupported.push(key);
      }
    }
    if (unsupported.length) out.unsupportedFields = unsupported;
    return out;
  }
  async function applyStyle(p, t) {
    const styleId = requireStr(p.styleId, "styleId");
    const node = await getNode(requireId(p), t);
    assertTarget(t);
    if (typeof node.applyAnimationStyle !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5E94\u7528 Motion \u52A8\u753B\u6837\u5F0F");
    }
    await node.applyAnimationStyle(styleId);
    assertTarget(t);
    markMutation(t, node);
    return { id: node.id, styleId, animationStyles: readProp(node, "animationStyles") };
  }
  async function removeStyle(p, t) {
    const styleId = requireStr(p.styleId, "styleId");
    const node = await getNode(requireId(p), t);
    assertTarget(t);
    if (typeof node.removeAnimationStyle !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u79FB\u9664 Motion \u52A8\u753B\u6837\u5F0F");
    }
    await node.removeAnimationStyle(styleId);
    assertTarget(t);
    markMutation(t, node);
    return { id: node.id, styleId, animationStyles: readProp(node, "animationStyles") };
  }
  function validateField(raw) {
    if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", "field \u5FC5\u987B\u662F\u5BF9\u8C61");
    if (!FIELD_TYPES.has(raw.type)) throw appErr("INVALID_PARAM", `field.type \u975E\u6CD5: ${raw.type}`);
    if (typeof raw.name !== "string" || !raw.name.length) throw appErr("INVALID_PARAM", "field.name \u5FC5\u586B");
    if (raw.type === "PAINT" || raw.type === "EFFECT") {
      if (!Number.isSafeInteger(raw.index) || raw.index < 0 || raw.index > 64) {
        throw appErr("INVALID_PARAM", `field.type \u4E3A ${raw.type} \u65F6 field.index \u5FC5\u987B\u662F 0\u201364 \u7684\u6574\u6570`);
      }
    }
    return raw;
  }
  function validateTrack(raw) {
    if (!isPlainObject2(raw)) throw appErr("INVALID_PARAM", "track \u5FC5\u987B\u662F\u5BF9\u8C61");
    if (!isPlainObject2(raw.baseValue)) throw appErr("INVALID_PARAM", "track.baseValue \u5FC5\u987B\u662F\u5BF9\u8C61");
    if (!Array.isArray(raw.keyframes) || raw.keyframes.length < 1 || raw.keyframes.length > MAX_KEYFRAMES) {
      throw appErr("INVALID_PARAM", `track.keyframes \u9700\u8981 1\u2013${MAX_KEYFRAMES} \u9879`);
    }
    let previous = -Infinity;
    raw.keyframes.forEach((frame, i) => {
      const label = `track.keyframes[${i}]`;
      if (!isPlainObject2(frame)) throw appErr("INVALID_PARAM", `${label} \u5FC5\u987B\u662F\u5BF9\u8C61`);
      if (typeof frame.timelinePosition !== "number" || !Number.isFinite(frame.timelinePosition) || frame.timelinePosition < 0) {
        throw appErr("INVALID_PARAM", `${label}.timelinePosition \u5FC5\u987B\u662F >=0 \u7684\u6570\u5B57`);
      }
      if (frame.timelinePosition <= previous) {
        throw appErr("INVALID_PARAM", `${label}.timelinePosition \u5FC5\u987B\u4E25\u683C\u9012\u589E`);
      }
      previous = frame.timelinePosition;
      if (!isPlainObject2(frame.value)) throw appErr("INVALID_PARAM", `${label}.value \u5FC5\u987B\u662F\u5BF9\u8C61`);
    });
    return raw;
  }
  async function applyTrack(p, t) {
    const field = validateField(p.field);
    const track = validateTrack(p.track);
    const node = await getNode(requireId(p), t);
    assertTarget(t);
    if (typeof node.applyManualKeyframeTrack !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u624B\u52A8\u5173\u952E\u5E27\u8F68\u9053");
    }
    await node.applyManualKeyframeTrack(field, track);
    assertTarget(t);
    markMutation(t, node);
    return { id: node.id, manualKeyframeTracks: readProp(node, "manualKeyframeTracks") };
  }
  async function removeTrack(p, t) {
    const field = validateField(p.field);
    const node = await getNode(requireId(p), t);
    assertTarget(t);
    if (typeof node.removeManualKeyframeTrack !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u79FB\u9664\u624B\u52A8\u5173\u952E\u5E27\u8F68\u9053");
    }
    await node.removeManualKeyframeTrack(field);
    assertTarget(t);
    markMutation(t, node);
    return { id: node.id, manualKeyframeTracks: readProp(node, "manualKeyframeTracks") };
  }
  async function setDuration(p, t) {
    requireId(p);
    if (typeof p.duration !== "number" || !Number.isFinite(p.duration) || p.duration <= 0) {
      throw appErr("INVALID_PARAM", "duration \u5FC5\u987B\u662F >0 \u7684\u6570\u5B57");
    }
    const node = await getNode(p.id, t);
    assertTarget(t);
    if (typeof node.setTimelineDuration !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8BBE\u7F6E\u65F6\u95F4\u7EBF\u65F6\u957F");
    }
    await node.setTimelineDuration(p.duration);
    assertTarget(t);
    markMutation(t, node);
    return { id: node.id, duration: p.duration };
  }
  async function handleMotion(p, t) {
    onlyKeys(p, ["action", "id", "styleId", "duration", "field", "track"]);
    switch (p.action) {
      case "listAnimationStyles":
        return listAnimationStyles(t);
      case "readNode":
        return readMotionNode(p, t);
      case "applyStyle":
        return applyStyle(p, t);
      case "removeStyle":
        return removeStyle(p, t);
      case "applyTrack":
        return applyTrack(p, t);
      case "removeTrack":
        return removeTrack(p, t);
      case "setDuration":
        return setDuration(p, t);
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
    }
  }
  function serializeShader(shader) {
    const objectLike = shader !== null && typeof shader === "object" && !Array.isArray(shader);
    if (!objectLike) return { id: null, name: null, type: null, imported: false };
    const out = {
      id: shader.id !== void 0 ? shader.id : null,
      name: shader.name !== void 0 ? shader.name : null,
      type: shader.type !== void 0 ? shader.type : null,
      imported: shader.imported === true
    };
    if ("propertyDefinitions" in shader) {
      let safe = null;
      try {
        safe = jsonSafe(shader.propertyDefinitions);
      } catch {
        safe = null;
      }
      if (safe !== null) out.propertyDefinitions = safe;
      else out.propertyDefinitionsReadable = false;
    }
    return out;
  }
  async function handleShaders(p, t) {
    onlyKeys(p, ["cursor"]);
    if (typeof figma.listAvailableShaders !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301 Shader API");
    }
    const raw = await figma.listAvailableShaders();
    assertTarget(t);
    const list = Array.isArray(raw) ? raw : [];
    const offset = p.cursor === void 0 ? 0 : Number(p.cursor);
    if (offset > list.length) throw appErr("INVALID_PARAM", "cursor \u8D85\u51FA\u8303\u56F4\uFF0C\u8BF7\u91CD\u65B0\u4ECE\u9996\u9875\u8BFB\u53D6");
    const page = list.slice(offset, offset + SHADER_PAGE_SIZE).map(serializeShader);
    const next = offset + page.length;
    return {
      shaders: page,
      total: list.length,
      nextCursor: next < list.length ? String(next) : null
    };
  }
  var handlers13 = {
    motion: handleMotion,
    shaders: handleShaders
  };

  // plugin/src/figjam.js
  var domainMeta11 = {
    name: "figjam",
    actions: ["createSticky", "updateSticky", "createShapeWithText", "createConnector", "updateConnector", "listNodes"],
    preconditions: ["\u9700\u5728\u5DF2\u6253\u5F00\u7684 FigJam \u6587\u4EF6\u4E2D\u8FD0\u884C\u63D2\u4EF6"],
    notes: ["\u4E0D\u63D0\u4F9B Mermaid \u89E3\u6790\u3001\u81EA\u52A8\u56FE\u5E03\u5C40\u6216\u5B98\u65B9\u56FE\u8868\u751F\u6210\u670D\u52A1", "listNodes \u4E3A\u504F\u79FB\u5F0F\u5206\u9875\uFF0C\u4E0D\u56FA\u5B9A\u6210\u5458\u5217\u8868\uFF1B\u8DE8\u9875\u8C03\u7528\u53EF\u80FD\u6F02\u79FB"]
  };
  var INTER = { family: "Inter", style: "Regular" };
  var MAGNETS = /* @__PURE__ */ new Set(["AUTO", "TOP", "BOTTOM", "LEFT", "RIGHT", "CENTER"]);
  var SHAPE_TYPES = /* @__PURE__ */ new Set([
    "SQUARE",
    "ELLIPSE",
    "DIAMOND",
    "TRIANGLE_UP",
    "TRIANGLE_DOWN",
    "ROUNDED_RECTANGLE",
    "HEXAGON",
    "CLOUD",
    "PARALLELOGRAM_RIGHT",
    "PARALLELOGRAM_LEFT",
    "STAR",
    "SPEECH_BUBBLE",
    "PIE"
  ]);
  var LIST_NODE_TYPES = ["STICKY", "SHAPE_WITH_TEXT", "CONNECTOR"];
  var CURSOR_RE = /^(0|[1-9][0-9]*)$/;
  var NAME_MAX = 1024;
  var LIST_CHARS_MAX = 200;
  function assertFigJam() {
    if (figma.editorType !== "figjam") throw appErr("EDITOR_UNSUPPORTED", "\u4EC5 FigJam \u7F16\u8F91\u5668\u53EF\u7528");
  }
  function requireText(p) {
    return requireStr(p.text, "text", { allowEmpty: true });
  }
  function writeLooseText(node, text) {
    if (node.text) node.text.characters = text;
    else node.characters = text;
  }
  function rollbackCreation(e, node, t) {
    try {
      node.remove();
      e.state = "rolled_back";
      t.affected = [];
    } catch (cleanup) {
      e.state = "partial";
      e.details = { cleanupError: cleanup.message };
    }
  }
  async function createSticky(p, t) {
    onlyKeys(p, ["action", "x", "y", "text", "name"]);
    requireNum(p.x, "x", -1e6, 1e6);
    requireNum(p.y, "y", -1e6, 1e6);
    requireText(p);
    if (p.name !== void 0) requireStr(p.name, "name", { allowEmpty: true });
    await loadFont(INTER);
    assertTarget(t);
    markMutation(t);
    const node = figma.createSticky();
    t.affected.push(node.id);
    try {
      markMutation(t, node);
      node.x = p.x;
      node.y = p.y;
      writeLooseText(node, p.text);
      if (p.name !== void 0) node.name = p.name;
    } catch (e) {
      rollbackCreation(e, node, t);
      throw e;
    }
    return buildNodeInfo(node);
  }
  async function updateSticky(p, t) {
    onlyKeys(p, ["action", "id", "text"]);
    requireText(p);
    const node = await getNode(requireStr(p.id, "id"), t);
    if (node.type !== "STICKY") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F FigJam \u4FBF\u7B3A");
    await loadFont(INTER);
    assertTarget(t);
    markMutation(t, node);
    writeLooseText(node, p.text);
    return buildNodeInfo(node);
  }
  async function createShapeWithText(p, t) {
    onlyKeys(p, ["action", "x", "y", "text", "shapeType"]);
    requireNum(p.x, "x", -1e6, 1e6);
    requireNum(p.y, "y", -1e6, 1e6);
    requireText(p);
    if (p.shapeType !== void 0 && !SHAPE_TYPES.has(p.shapeType)) {
      throw appErr("INVALID_PARAM", `shapeType \u4E0D\u5728\u5141\u8BB8\u503C\u4E2D: ${p.shapeType}`);
    }
    await loadFont(INTER);
    assertTarget(t);
    markMutation(t);
    const node = figma.createShapeWithText();
    t.affected.push(node.id);
    try {
      markMutation(t, node);
      node.x = p.x;
      node.y = p.y;
      if (p.shapeType !== void 0 && "shapeType" in node) node.shapeType = p.shapeType;
      writeLooseText(node, p.text);
    } catch (e) {
      rollbackCreation(e, node, t);
      throw e;
    }
    return buildNodeInfo(node);
  }
  function connectEndpoint(connector, side, node, magnet) {
    const endpoint = connector[side];
    if (!endpoint) return;
    if (typeof endpoint.connectTo !== "function") {
      throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u8FDE\u63A5\u7EBF\u7AEF\u70B9\u7ED1\u5B9A");
    }
    if (magnet === void 0) endpoint.connectTo(node);
    else endpoint.connectTo(node, magnet);
  }
  async function createConnector(p, t) {
    onlyKeys(p, ["action", "startNodeId", "endNodeId", "startMagnet", "endMagnet"]);
    requireStr(p.startNodeId, "startNodeId");
    requireStr(p.endNodeId, "endNodeId");
    for (const key of ["startMagnet", "endMagnet"]) {
      if (p[key] !== void 0 && !MAGNETS.has(p[key])) {
        throw appErr("INVALID_PARAM", `${key} \u4E0D\u5728\u5141\u8BB8\u503C\u4E2D: ${p[key]}`);
      }
    }
    const startNode = await getNode(p.startNodeId, t);
    const endNode = await getNode(p.endNodeId, t);
    assertTarget(t);
    markMutation(t);
    const connector = figma.createConnector();
    t.affected.push(connector.id);
    try {
      markMutation(t, connector);
      connectEndpoint(connector, "start", startNode, p.startMagnet);
      connectEndpoint(connector, "end", endNode, p.endMagnet);
    } catch (e) {
      rollbackCreation(e, connector, t);
      throw e;
    }
    const out = { id: connector.id, startNodeId: startNode.id, endNodeId: endNode.id };
    if (p.startMagnet !== void 0) out.startMagnet = p.startMagnet;
    if (p.endMagnet !== void 0) out.endMagnet = p.endMagnet;
    return out;
  }
  async function updateConnector(p, t) {
    onlyKeys(p, ["action", "id", "text"]);
    requireText(p);
    const node = await getNode(requireStr(p.id, "id"), t);
    if (node.type !== "CONNECTOR") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u8FDE\u63A5\u7EBF");
    assertTarget(t);
    markMutation(t, node);
    if ("textCharacters" in node) node.textCharacters = p.text;
    else if (node.text) node.text.characters = p.text;
    else node.characters = p.text;
    return buildNodeInfo(node);
  }
  function readLooseCharacters(node) {
    try {
      if ("textCharacters" in node) return node.textCharacters;
      if (node.text) return node.text.characters;
      if ("characters" in node) return node.characters;
    } catch (e) {
    }
    return void 0;
  }
  async function listNodes(p, t) {
    onlyKeys(p, ["action", "cursor", "limit"]);
    assertTarget(t);
    const limit = p.limit === void 0 ? 50 : requireNum(p.limit, "limit", 1, 100);
    if (!Number.isInteger(limit)) throw appErr("INVALID_PARAM", "limit \u5FC5\u987B\u662F\u6574\u6570");
    if (p.cursor !== void 0 && (typeof p.cursor !== "string" || !CURSOR_RE.test(p.cursor))) {
      throw appErr("INVALID_PARAM", "cursor \u5FC5\u987B\u662F\u975E\u8D1F\u6574\u6570\u7684\u5B57\u7B26\u4E32");
    }
    const all = figma.currentPage.children.filter((node) => LIST_NODE_TYPES.includes(node.type));
    const offset = p.cursor === void 0 ? 0 : Number(p.cursor);
    if (!Number.isSafeInteger(offset) || offset > all.length) {
      throw appErr("INVALID_PARAM", "cursor \u8D85\u51FA\u8303\u56F4\uFF0C\u8BF7\u91CD\u65B0\u4ECE\u9996\u9875\u8BFB\u53D6");
    }
    const nodes = all.slice(offset, offset + limit).map((node) => {
      const item = { id: node.id, type: node.type, name: String(node.name).slice(0, NAME_MAX) };
      const characters = readLooseCharacters(node);
      if (typeof characters === "string") {
        if (characters.length > LIST_CHARS_MAX) {
          item.characters = characters.slice(0, LIST_CHARS_MAX);
          item.truncated = true;
        } else item.characters = characters;
      }
      return item;
    });
    const next = offset + nodes.length;
    return {
      nodes,
      total: all.length,
      nextCursor: next < all.length ? String(next) : null,
      truncated: next < all.length
    };
  }
  async function handleFigjam(p, t) {
    assertFigJam();
    switch (p.action) {
      case "createSticky":
        return createSticky(p, t);
      case "updateSticky":
        return updateSticky(p, t);
      case "createShapeWithText":
        return createShapeWithText(p, t);
      case "createConnector":
        return createConnector(p, t);
      case "updateConnector":
        return updateConnector(p, t);
      case "listNodes":
        return listNodes(p, t);
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
    }
  }
  var handlers14 = {
    figjam: handleFigjam
  };

  // plugin/src/slides.js
  var domainMeta12 = {
    name: "slides",
    actions: ["listStructure", "createSlide", "createSlideRow", "addContent", "updateContent"],
    preconditions: ["\u9700\u5728\u5DF2\u6253\u5F00\u7684 Slides \u6587\u4EF6\u4E2D\u8FD0\u884C\u63D2\u4EF6"],
    notes: ["\u4E0D\u65B0\u5EFA\u6F14\u793A\u6587\u4EF6\uFF1B\u4E0D\u63D0\u4F9B\u4E3B\u9898\u63A8\u5BFC\u6216\u6A21\u677F\u5E93\u68C0\u7D22"]
  };
  var INTER2 = { family: "Inter", style: "Regular" };
  var CONTENT_TYPES = ["FRAME", "RECTANGLE", "ELLIPSE", "TEXT", "LINE"];
  var CREATORS = { FRAME: "createFrame", RECTANGLE: "createRectangle", ELLIPSE: "createEllipse", TEXT: "createText", LINE: "createLine" };
  var STRUCTURE_LIMIT = 200;
  var NAME_MAX2 = 1024;
  var UPDATE_CONTENT_KEYS = ["type", "text", "x", "y", "width", "height", "fontSize", "fills", "name"];
  function assertSlides() {
    if (figma.editorType !== "slides") throw appErr("EDITOR_UNSUPPORTED", "\u4EC5 Slides \u7F16\u8F91\u5668\u53EF\u7528");
  }
  async function findDeckNode(id, t) {
    requireStr(id, "id");
    const node = await figma.getNodeByIdAsync(id);
    assertTarget(t);
    if (!node || node.removed) throw appErr("NODE_NOT_FOUND", `\u627E\u4E0D\u5230\u8282\u70B9: ${id}`);
    if (node.type === "DOCUMENT" || node.type === "PAGE") {
      throw appErr("INVALID_TARGET", "\u8BF7\u4EE5\u5E7B\u706F\u7247\u6216\u5E7B\u706F\u7247\u5185\u5BB9\u8282\u70B9\u4E3A\u76EE\u6807");
    }
    return node;
  }
  function rollbackCreation2(e, node, t) {
    try {
      node.remove();
      e.state = "rolled_back";
      t.affected = [];
    } catch (cleanup) {
      e.state = "partial";
      e.details = { cleanupError: cleanup.message };
    }
  }
  async function listStructure(p, t) {
    onlyKeys(p, ["action"]);
    assertTarget(t);
    const structure = [];
    const visit = (node, depth) => {
      if (!node || structure.length >= STRUCTURE_LIMIT || depth > 3) return;
      const item = { id: node.id, type: node.type };
      if (node.name !== void 0) item.name = String(node.name).slice(0, NAME_MAX2);
      if (Array.isArray(node.children)) {
        item.childCount = node.children.length;
        structure.push(item);
        for (const child of node.children) visit(child, depth + 1);
      } else {
        structure.push(item);
      }
    };
    visit(figma.currentPage, 0);
    return { structure, total: structure.length, truncated: false };
  }
  async function createSlideNode(p, t, nodeType) {
    onlyKeys(p, ["action", "order", "relativeToId"]);
    if (p.order !== void 0 && p.order !== "end") {
      throw appErr("UNSUPPORTED", '\u5F53\u524D\u7248\u672C\u4EC5\u652F\u6301 order: "end"\uFF08\u8FFD\u52A0\u5230\u6F14\u793A\u6587\u7A3F\u672B\u5C3E\uFF09');
    }
    assertTarget(t);
    markMutation(t);
    let node;
    if (nodeType === "SLIDE") {
      try {
        node = figma.createSlide();
      } catch (bareError) {
        const message = String(bareError?.message || bareError);
        if (message.includes("SLIDE")) {
          throw appErr("EDITOR_LIMITATION", `\u5F53\u524D Figma \u7248\u672C\u7684 createSlide \u53D7\u9650: ${message}`);
        }
        throw bareError;
      }
    } else {
      node = figma.createSlideRow();
    }
    t.affected.push(node.id);
    try {
      if (!node.parent || node.removed) throw appErr("PLUGIN_ERROR", "\u521B\u5EFA\u540E\u672A\u843D\u5165\u6F14\u793A\u6587\u7A3F\u7ED3\u6784");
    } catch (e) {
      rollbackCreation2(e, node, t);
      throw e;
    }
    return buildNodeInfo(node);
  }
  async function createSlide(p, t) {
    return createSlideNode(p, t, "SLIDE");
  }
  async function addContent(p, t) {
    if (!isPlainObject2(p.content) || typeof p.content.type !== "string") throw appErr("INVALID_PARAM", "addContent \u9700\u8981 content.type");
    onlyKeys(p, ["action", "slideId", "content"]);
    requireStr(p.slideId, "slideId");
    const content = p.content;
    if (!isPlainObject2(content)) throw appErr("INVALID_PARAM", "content \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    if (!CONTENT_TYPES.includes(content.type)) {
      throw appErr("INVALID_PARAM", `content.type \u4E0D\u5728\u5141\u8BB8\u503C\u4E2D: ${content.type}`);
    }
    if (content.type === "LINE" && content.height !== void 0) {
      throw appErr("INVALID_PARAM", "LINE \u7684 height \u5FC5\u987B\u4E3A 0");
    }
    if (content.type !== "TEXT") {
      if (content.text !== void 0) throw appErr("INVALID_PARAM", "text \u53EA\u7528\u4E8E TEXT \u7C7B\u578B\u5185\u5BB9");
      if (content.fontSize !== void 0) throw appErr("INVALID_PARAM", "fontSize \u53EA\u7528\u4E8E TEXT \u7C7B\u578B\u5185\u5BB9");
    }
    const slide = await findDeckNode(p.slideId, t);
    if (slide.type !== "SLIDE") throw appErr("INVALID_TARGET", "\u76EE\u6807\u4E0D\u662F\u5E7B\u706F\u7247");
    if (content.x !== void 0) requireNum(content.x, "content.x", -1e6, 1e6);
    if (content.y !== void 0) requireNum(content.y, "content.y", -1e6, 1e6);
    if (content.width !== void 0) requireNum(content.width, "content.width", 1, 1e5);
    if (content.height !== void 0) requireNum(content.height, "content.height", 1, 1e5);
    if (content.name !== void 0) requireStr(content.name, "content.name", { allowEmpty: true });
    if (content.fills !== void 0) validatePaints(content.fills, "content.fills");
    if (content.type === "TEXT") {
      requireStr(content.text, "content.text", { allowEmpty: true });
      if (content.fontSize !== void 0) requireNum(content.fontSize, "content.fontSize", 1, 1e3);
    }
    if (content.type === "TEXT") await loadFont(INTER2);
    assertTarget(t);
    markMutation(t);
    const node = figma[CREATORS[content.type]]();
    t.affected.push(node.id);
    try {
      if (typeof slide.appendChild !== "function") {
        throw appErr("UNSUPPORTED", "\u5F53\u524D\u73AF\u5883\u4E0D\u652F\u6301\u5411\u5E7B\u706F\u7247\u6DFB\u52A0\u5185\u5BB9");
      }
      if (content.name !== void 0) node.name = content.name;
      if (content.x !== void 0) node.x = content.x;
      if (content.y !== void 0) node.y = content.y;
      if (content.width !== void 0 || content.height !== void 0) {
        node.resize(
          content.width !== void 0 ? content.width : node.width,
          content.type === "LINE" ? 0 : content.height !== void 0 ? content.height : node.height
        );
      }
      if (content.type === "TEXT") {
        if (content.fontSize !== void 0) node.fontSize = content.fontSize;
        node.characters = content.text;
      }
      if (content.fills !== void 0) node.fills = validatePaints(content.fills, "content.fills");
      slide.appendChild(node);
    } catch (e) {
      rollbackCreation2(e, node, t);
      throw e;
    }
    return buildNodeInfo(node);
  }
  async function updateContent(p, t) {
    onlyKeys(p, ["action", "id", "content"]);
    requireStr(p.id, "id");
    const content = p.content;
    if (!isPlainObject2(content)) throw appErr("INVALID_PARAM", "content \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
    for (const key of Object.keys(content)) {
      if (!UPDATE_CONTENT_KEYS.includes(key)) throw appErr("INVALID_PARAM", `\u4E0D\u652F\u6301\u7684\u5185\u5BB9\u5C5E\u6027: ${key}`);
    }
    const node = await findDeckNode(p.id, t);
    if (node.type === "LINE" && content.height !== void 0) {
      throw appErr("INVALID_PARAM", "LINE \u7684 height \u5FC5\u987B\u4E3A 0");
    }
    if (content.x !== void 0) requireNum(content.x, "content.x", -1e6, 1e6);
    if (content.y !== void 0) requireNum(content.y, "content.y", -1e6, 1e6);
    if (content.width !== void 0) requireNum(content.width, "content.width", 1, 1e5);
    if (content.height !== void 0) requireNum(content.height, "content.height", 1, 1e5);
    if (content.name !== void 0) requireStr(content.name, "content.name", { allowEmpty: true });
    if (content.text !== void 0) requireStr(content.text, "content.text", { allowEmpty: true });
    if (content.fontSize !== void 0) requireNum(content.fontSize, "content.fontSize", 1, 1e3);
    if (content.fills !== void 0) validatePaints(content.fills, "content.fills");
    const isText = node.type === "TEXT";
    for (const key of Object.keys(content)) {
      if (key === "type") continue;
      if (key === "width" || key === "height") {
        if (typeof node.resize !== "function") throw appErr("UNSUPPORTED_PROPERTY", "\u8282\u70B9\u4E0D\u80FD\u8C03\u6574\u5C3A\u5BF8");
        continue;
      }
      if (key === "text" || key === "fontSize") {
        if (!isText) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 ${key}`);
        continue;
      }
      if (!(key in node)) throw appErr("UNSUPPORTED_PROPERTY", `${node.type} \u4E0D\u652F\u6301 ${key}`);
    }
    if (isText && (content.text !== void 0 || content.fontSize !== void 0)) await loadNodeFonts(node);
    assertTarget(t);
    markMutation(t);
    if (!t.affected.includes(node.id)) t.affected.push(node.id);
    try {
      if (content.name !== void 0) node.name = content.name;
      if (content.x !== void 0) node.x = content.x;
      if (content.y !== void 0) node.y = content.y;
      if (content.width !== void 0 || content.height !== void 0) {
        node.resize(
          content.width !== void 0 ? content.width : node.width,
          node.type === "LINE" ? 0 : content.height !== void 0 ? content.height : node.height
        );
      }
      if (isText && content.fontSize !== void 0) node.fontSize = content.fontSize;
      if (isText && content.text !== void 0) node.characters = content.text;
      if (content.fills !== void 0) node.fills = validatePaints(content.fills, "content.fills");
    } catch (e) {
      e.state = t.mutating ? "partial" : "not_started";
      throw e;
    }
    return buildNodeInfo(node);
  }
  async function createSlideRow(p, t) {
    return createSlideNode(p, t, "SLIDE_ROW");
  }
  async function handleSlides(p, t) {
    assertSlides();
    switch (p.action) {
      case "listStructure":
        return listStructure(p, t);
      case "createSlide":
        return createSlide(p, t);
      case "createSlideRow":
        return createSlideRow(p, t);
      case "addContent":
        return addContent(p, t);
      case "updateContent":
        return updateContent(p, t);
      default:
        throw appErr("INVALID_PARAM", `\u672A\u77E5 action: ${p.action}`);
    }
  }
  var handlers15 = {
    slides: handleSlides
  };

  // plugin/src/capabilities.js
  var DOMAINS = [
    { name: "read", label: "\u4FE1\u606F\u8BFB\u53D6", commands: ["getContext", "getSelection", "getNodeInfo"], meta: null },
    { name: "semantic-read", label: "\u8BED\u4E49\u67E5\u8BE2\u4E0E\u7EED\u8BFB", meta: domainMeta },
    { name: "pages", label: "\u9875\u9762\u7BA1\u7406", commands: ["listPages", "managePage"], meta: null },
    { name: "assets", label: "\u8D44\u6E90\u4E0E\u622A\u56FE", meta: domainMeta2 },
    { name: "edit", label: "\u57FA\u7840\u7F16\u8F91", commands: ["createNode", "modifyNode", "deleteNode", "setText"], meta: null },
    { name: "hierarchy", label: "\u5C42\u7EA7\u64CD\u4F5C", meta: domainMeta3 },
    { name: "vector", label: "\u77E2\u91CF\u51E0\u4F55", meta: domainMeta4 },
    { name: "layout", label: "\u5E03\u5C40", meta: domainMeta5 },
    { name: "text-range", label: "\u5BCC\u6587\u672C\u533A\u95F4", meta: domainMeta6 },
    { name: "visual", label: "\u89C6\u89C9\u5C5E\u6027", meta: domainMeta7 },
    { name: "design-system", label: "\u8BBE\u8BA1\u7CFB\u7EDF", meta: domainMeta8 },
    { name: "prototype", label: "\u539F\u578B\u4E0E\u6279\u91CF", meta: domainMeta9 },
    { name: "motion", label: "\u52A8\u753B\u4E0E\u89C6\u9891", meta: domainMeta10 },
    { name: "figjam", label: "FigJam", meta: domainMeta11 },
    { name: "slides", label: "Slides", meta: domainMeta12 }
  ];
  function capabilityReport() {
    const context = getContext();
    const editorSupported = {
      pages: context.editorType === "figma",
      assets: context.editorType === "figma" || context.editorType === "slides",
      edit: context.editorType === "figma",
      hierarchy: context.editorType === "figma",
      vector: context.editorType === "figma",
      layout: context.editorType === "figma",
      "text-range": context.editorType === "figma",
      visual: context.editorType === "figma",
      "design-system": context.editorType === "figma",
      prototype: context.editorType === "figma",
      motion: context.editorType === "figma",
      figjam: context.editorType === "figjam",
      slides: context.editorType === "slides",
      read: true,
      "semantic-read": true
    };
    const domains = DOMAINS.map((domain) => {
      const implemented = domain.meta !== null ? domain.meta.actions.length > 0 : Array.isArray(domain.commands) && domain.commands.length > 0 && domain.commands.every((command) => Object.prototype.hasOwnProperty.call(HANDLERS, command));
      return {
        name: domain.name,
        label: domain.label,
        status: !editorSupported[domain.name] ? "editor-unsupported" : implemented ? "implemented" : "not-implemented",
        actions: domain.meta ? domain.meta.actions : domain.commands,
        preconditions: domain.meta ? domain.meta.preconditions || [] : [],
        notes: domain.meta ? domain.meta.notes || [] : [],
        verified: false
      };
    });
    return {
      ...context,
      protocol: 3,
      acceptance: { automatedTests: true, realCanvas: "pending" },
      implementedCommands: Object.keys(HANDLERS).sort(),
      domains,
      editorNotes: {
        figma: context.editorType === "figma" ? "Design \u7F16\u8F91\u53EF\u7528" : null,
        figjam: context.editorType === "figjam" ? "FigJam \u7F16\u8F91\u53EF\u7528" : null,
        slides: context.editorType === "slides" ? "Slides \u7F16\u8F91\u53EF\u7528" : null
      }
    };
  }

  // plugin/src/entry.js
  var HANDLERS = {
    ...handlers,
    ...handlers2,
    ...handlers3,
    ...handlers4,
    ...handlers5,
    ...handlers6,
    ...handlers7,
    ...handlers8,
    ...handlers9,
    ...handlers10,
    ...handlers11,
    ...handlers12,
    ...handlers13,
    ...handlers14,
    ...handlers15,
    batch: handleBatch,
    getCapabilities: capabilityReport
  };
  var pluginSchemas = /* @__PURE__ */ new Map();
  function pluginSchemaFor(command) {
    if (pluginSchemas.has(command)) return pluginSchemas.get(command);
    const tool = Object.values(TOOLS).find((t) => t.command === command);
    if (!tool) return null;
    const override = SCHEMA_OVERRIDES[command];
    const source = override || tool.inputSchema;
    const schema = JSON.parse(JSON.stringify(source));
    for (const key of ["sessionId", "pageId", "pageRevision", "operationId"]) delete schema.properties[key];
    if (["getScreenshot", "exportAsset", "importAsset"].includes(command)) {
      schema.properties.transferId = { type: "string", maxLength: 64 };
    }
    if (Object.prototype.hasOwnProperty.call(schema.properties, "nodeId")) {
      schema.properties.id = schema.properties.nodeId;
      delete schema.properties.nodeId;
    }
    let required = (schema.required || []).filter((k) => !["sessionId", "pageId", "pageRevision", "operationId"].includes(k));
    required = required.map((k) => k === "nodeId" ? "id" : k);
    if (required.length) schema.required = required;
    else delete schema.required;
    delete schema.allOf;
    pluginSchemas.set(command, schema);
    return schema;
  }
  var SCHEMA_OVERRIDES = { ...schemas || {} };
  var queue = Promise.resolve();
  var postToUi = (value) => figma.ui.postMessage(value);
  var uploads = /* @__PURE__ */ new Map();
  function publishContext() {
    postToUi({ type: "context", context: getContext() });
  }
  function registerUpload(id, transferId, operationId, totalBytes, data, meta = {}) {
    return new Promise((resolve, reject) => {
      uploads.set(id, { transferId, operationId, totalBytes, data, meta, resolve, reject });
      postToUi({
        type: "transfer_upload",
        id,
        transferId,
        operationId,
        totalBytes,
        data,
        ...meta.format ? { format: meta.format } : {},
        ...meta.mime ? { mime: meta.mime } : {},
        ...meta.width !== void 0 ? { width: meta.width } : {},
        ...meta.height !== void 0 ? { height: meta.height } : {}
      });
    });
  }
  function resolveUpload(id, ok, errorMessage) {
    const upload = uploads.get(id);
    if (!upload) return;
    uploads.delete(id);
    if (ok) upload.resolve({ transferId: upload.transferId });
    else upload.reject(appErr("TRANSFER_FAILED", errorMessage || "\u8D44\u6E90\u4F20\u8F93\u5931\u8D25"));
  }
  function failure(e, t) {
    return { ok: false, error: {
      code: e.code || "PLUGIN_ERROR",
      message: e.message || String(e),
      state: e.state || (t.mutating ? "unknown" : "not_started"),
      affectedNodeIds: t.affected,
      ...e.details ? { details: e.details } : {},
      ...e.batchResults ? { details: { ...e.details, steps: e.batchResults } } : {}
    } };
  }
  function sanitize(value) {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value !== null && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value)) {
        if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
        out[key] = sanitize(value[key]);
      }
      return out;
    }
    return value;
  }
  async function execute(msg, t) {
    try {
      assertTarget(t);
      if (!Object.prototype.hasOwnProperty.call(HANDLERS, msg.command)) throw appErr("UNKNOWN_COMMAND", "\u672A\u77E5\u547D\u4EE4");
      if (!isPlainObject2(msg.params)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      msg.params = sanitize(msg.params);
      const schema = pluginSchemaFor(msg.command);
      if (schema) {
        try {
          validateSchema(msg.params, schema);
        } catch (e) {
          throw appErr("INVALID_PARAM", e.message);
        }
      }
      const write = isWriteCall(msg.command, msg.params);
      if (write && (typeof msg.operationId !== "string" || !msg.operationId || msg.operationId.length > 128)) {
        throw appErr("INVALID_PARAM", "\u5199\u5165\u7F3A\u5C11 operationId");
      }
      const data = await HANDLERS[msg.command](msg.params, t, msg);
      return { ok: true, data: write ? { ...data, state: "succeeded", operationId: msg.operationId, affectedNodeIds: t.affected } : data };
    } catch (e) {
      return failure(e, t);
    }
  }
  async function runVideoJob(msg) {
    const job = getJob(msg.operationId);
    if (!job) return;
    updateJob(msg.operationId, { state: "running" });
    const t = makeTarget(msg);
    t.operationId = msg.operationId;
    try {
      const result = await startVideoJob(msg.params, t);
      updateJob(msg.operationId, { state: "succeeded", result });
    } catch (e) {
      updateJob(msg.operationId, { state: "failed", result: { error: { code: e.code || "PLUGIN_ERROR", message: e.message || String(e) } } });
    }
  }
  async function dispatch(msg) {
    const t = makeTarget(msg);
    const reply = (r) => postToUi({ type: "exec_result", id: msg.id, ...r });
    if (msg.command === "ping") {
      try {
        reply({ ok: true, data: { pong: true, ...getContext() } });
      } catch (e) {
        reply(failure(e, t));
      }
      return;
    }
    if (msg.command === "getOperation") {
      try {
        assertAuthGeneration(t);
        requireStr(msg.params.operationId, "operationId");
        const id = msg.params.operationId;
        if (id.length > 128) throw appErr("INVALID_PARAM", "operationId \u8FC7\u957F");
        const job = getJob(id);
        if (job) {
          if (job.target && job.target.sessionId !== msg.sessionId) throw appErr("OPERATION_TARGET_MISMATCH", "\u64CD\u4F5C\u5C5E\u4E8E\u53E6\u4E00\u76EE\u6807");
          reply({ ok: true, data: { operationId: id, state: job.state, jobId: id, result: job.result } });
          return;
        }
        const rec = getOperation(id);
        if (rec && rec.sessionId !== msg.sessionId) {
          reply(failure(appErr("OPERATION_TARGET_MISMATCH", "\u64CD\u4F5C\u5C5E\u4E8E\u53E6\u4E00\u76EE\u6807"), t));
          return;
        }
        reply({ ok: true, data: rec ? { operationId: id, state: rec.state, result: rec.result || null } : { operationId: id, state: "not_found" } });
      } catch (e) {
        reply(failure(e, t));
      }
      return;
    }
    try {
      assertTarget(t);
    } catch (e) {
      reply(failure(e, t));
      return;
    }
    if (msg.command === "exportVideo") {
      try {
        if (!isPlainObject2(msg.params)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
        validateSchema(msg.params, pluginSchemaFor("exportVideo"));
        const id = requireStr(msg.operationId, "operationId");
        const existing = getJob(id);
        if (existing) {
          if (canonical(existing.params) !== canonical(msg.params)) {
            throw appErr("OPERATION_CONFLICT", "\u540C\u4E00\u4E2A operationId \u4E0D\u80FD\u7528\u4E8E\u4E0D\u540C\u64CD\u4F5C");
          }
          reply({ ok: true, data: { operationId: id, state: existing.state, jobId: id, result: existing.result, ...getContext() } });
          return;
        }
        createJob(id, { params: msg.params, target: { sessionId: msg.sessionId, pageId: msg.pageId } });
        reply({ ok: true, data: { state: "accepted", jobId: id, ...getContext() } });
        void runVideoJob(msg);
      } catch (e) {
        reply(failure(e, t));
      }
      return;
    }
    const write = isWriteCall(msg.command, msg.params);
    if (!write) {
      const task = queue.then(() => execute(msg, t));
      queue = task.then(() => void 0, () => void 0);
      reply(await task);
      return;
    }
    try {
      const id = requireStr(msg.operationId, "operationId");
      if (id.length > 128) throw appErr("INVALID_PARAM", "operationId \u8FC7\u957F");
      if (!isPlainObject2(msg.params)) throw appErr("INVALID_PARAM", "params \u5FC5\u987B\u662F\u666E\u901A\u5BF9\u8C61");
      const signature = operationRecordKey(id, msg.sessionId, msg.pageId, msg.command, msg.params);
      let rec = getOperation(id);
      if (rec) {
        if (rec.signature !== signature) throw appErr("OPERATION_CONFLICT", "\u540C\u4E00\u4E2A operationId \u4E0D\u80FD\u7528\u4E8E\u4E0D\u540C\u64CD\u4F5C");
        reply(await rec.promise);
        return;
      }
      const reserve = signature.length * 2 + 1024;
      operationCapacity(reserve);
      rec = { signature, sessionId: msg.sessionId, pageId: msg.pageId, state: "queued", result: null, reserve };
      reserveOperation(id, rec);
      rec.promise = queue.then(async () => {
        rec.state = "running";
        const result = operationBudgetAvailable() ? await execute(msg, t) : failure(appErr("OPERATION_CAPACITY", "\u64CD\u4F5C\u8BB0\u5F55\u5DF2\u6EE1\uFF0C\u8BF7\u5BF9\u8D26\u540E\u91CD\u5F00\u63D2\u4EF6"), t);
        rec.result = result;
        addOperationBytes(JSON.stringify(result).length * 2 - 2048);
        rec.state = result.ok ? "succeeded" : result.error.state === "partial" ? "partial" : result.error.state === "unknown" ? "unknown" : "failed";
        return result;
      });
      queue = rec.promise.then(() => void 0, () => void 0);
      reply(await rec.promise);
    } catch (e) {
      reply(failure(e, t));
    }
  }
  var BRIDGE_URL = "ws://localhost:9753/plugin";
  var AUTH_TOKEN_KEY = "bridgeToken";
  figma.showUI(__html__, { width: 380, height: 520 });
  postToUi({ type: "init", context: getContext(), bridgeUrl: BRIDGE_URL });
  figma.on("currentpagechange", () => {
    bumpPageRevision();
    postToUi({ type: "context", context: getContext() });
  });
  figma.ui.onmessage = async (msg) => {
    if (!isPlainObject2(msg)) return;
    if (msg.type === "exec" && (typeof msg.id === "string" || typeof msg.id === "number")) {
      await dispatch(msg);
      return;
    }
    if (msg.type === "import_asset_request" && (typeof msg.id === "string" || typeof msg.id === "number")) {
      const exec = {
        type: "exec",
        id: msg.id,
        sessionId: msg.sessionId,
        pageId: msg.pageId,
        pageRevision: msg.pageRevision,
        command: "importAsset",
        params: msg.params,
        ...msg.operationId === void 0 ? {} : { operationId: msg.operationId }
      };
      await dispatch(exec);
      return;
    }
    if (msg.type === "transfer_upload_done") {
      resolveUpload(msg.id, msg.ok === true, msg.error);
      return;
    }
    if (msg.type === "revoke") {
      rotateSession();
      bumpPageRevision();
      clearAllRecords();
      postToUi({ type: "context", context: getContext() });
      return;
    }
    if (msg.type === "getToken") {
      postToUi({ type: "context", context: getContext() });
      try {
        const t = await figma.clientStorage.getAsync(AUTH_TOKEN_KEY);
        postToUi({ type: "token", token: typeof t === "string" && /^[a-f0-9]{64}$/.test(t) ? t : "" });
      } catch (e) {
        postToUi({ type: "token", token: "", error: "\u65E0\u6CD5\u8BFB\u53D6\u672C\u5730\u914D\u5BF9\u4FE1\u606F" });
      }
    } else if (msg.type === "saveToken") {
      try {
        if (typeof msg.token !== "string" || !/^[a-f0-9]{64}$/.test(msg.token)) throw new Error("\u914D\u5BF9\u5BC6\u94A5\u683C\u5F0F\u9519\u8BEF");
        await figma.clientStorage.setAsync(AUTH_TOKEN_KEY, msg.token);
        postToUi({ type: "saved", ok: true });
      } catch (e) {
        postToUi({ type: "saved", ok: false, error: e.message });
      }
    } else if (msg.type === "clearToken") {
      try {
        await figma.clientStorage.deleteAsync(AUTH_TOKEN_KEY);
        postToUi({ type: "tokenCleared", ok: true });
      } catch (e) {
        postToUi({ type: "tokenCleared", ok: false, error: e.message });
      }
    }
  };
})();
