// --- DOM Elements ---
const canvasContainer = document.getElementById('canvas-container');
const canvas = document.getElementById('drawingCanvas');
const ctx = canvas.getContext('2d');
const deleteShapeBtn = document.getElementById('deleteShapeBtn');
const toast = document.getElementById('toast');
const toolBtns = {
  select: document.getElementById('tool-select'),
  rectangle: document.getElementById('tool-rectangle'),
  line: document.getElementById('tool-line'),
  circle: document.getElementById('tool-circle'),
};
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const zoomResetBtn = document.getElementById('zoomResetBtn');
const zoomLevelDisplay = document.getElementById('zoomLevelDisplay');
const showDimensionsToggle = document.getElementById('showDimensionsToggle');
const inspector = document.getElementById('inspector');
const inspectorContent = document.getElementById('inspector-content');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const saveToCloudBtn = document.getElementById('saveToCloudBtn');
const loadFromCloudBtn = document.getElementById('loadFromCloudBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

// --- State Management ---
let shapes = [];
let selectedShape = null;
let currentTool = 'select';
let isDrawing = false;
let isDragging = false;
let isResizing = false;
let isPanning = false;
let isRotating = false;
let isShiftDown = false;
let resizeHandle = null;
let startX, startY, endX, endY;
let lastPanPoint = { x: 0, y: 0 };
let dragStart = {};
let showDimensions = true;
let scale = 1.0;
let viewOffsetX = 0;
let viewOffsetY = 0;

let currentStyle = {
  lineWidth: 1,
  strokeColor: '#000000',
  fillColor: '#E5E7EB',
};
let history = [];
let historyIndex = -1;

// --- Constants ---
const MIN_SCALE = 0.1;
const MAX_SCALE = 10.0;
const HANDLE_SIZE = 8;
const MIN_SHAPE_SIZE = 10;
const LINE_SELECT_TOLERANCE = 5;
const PIXELS_PER_CM = 5;
const ROTATE_HANDLE_OFFSET = 30;

// --- Firebase Functions ---
async function saveToCloud() {
  try {
    if (!window.firebaseDB) {
      showToast('Firebase가 초기화되지 않았습니다.');
      return;
    }

    const projectName = prompt(
      '프로젝트 이름을 입력하세요:',
      'my-drawing-' + Date.now()
    );
    if (!projectName) return;

    const { collection, addDoc } = window.firebaseCollections;
    const docRef = await addDoc(collection(window.firebaseDB, 'drawings'), {
      name: projectName,
      shapes: shapes,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    showToast(`클라우드에 저장되었습니다: ${projectName}`);
    console.log('Document written with ID: ', docRef.id);
  } catch (error) {
    console.error('Error adding document: ', error);
    showToast('클라우드 저장 중 오류가 발생했습니다.');
  }
}

async function loadFromCloud() {
  try {
    if (!window.firebaseDB) {
      showToast('Firebase가 초기화되지 않았습니다.');
      return;
    }

    const { collection, getDocs } = window.firebaseCollections;
    const querySnapshot = await getDocs(
      collection(window.firebaseDB, 'drawings')
    );

    if (querySnapshot.empty) {
      showToast('저장된 도면이 없습니다.');
      return;
    }

    // 간단한 선택 UI
    let options = '';
    const docs = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      docs.push({ id: doc.id, data });
      options += `${docs.length}. ${data.name} (${new Date(
        data.createdAt.seconds * 1000
      ).toLocaleDateString()})\n`;
    });

    const selection = prompt(
      `불러올 도면을 선택하세요:\n${options}\n번호를 입력하세요:`
    );
    const index = parseInt(selection) - 1;

    if (index >= 0 && index < docs.length) {
      shapes = docs[index].data.shapes || [];
      selectShape(null);
      history = [];
      historyIndex = -1;
      saveState();
      draw();
      showToast(`도면을 불러왔습니다: ${docs[index].data.name}`);
    } else {
      showToast('잘못된 선택입니다.');
    }
  } catch (error) {
    console.error('Error getting documents: ', error);
    showToast('클라우드 불러오기 중 오류가 발생했습니다.');
  }
}

// --- Utility & Viewport Functions ---
function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function getScreenPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function getWorldPos(screenPos) {
  return {
    x: (screenPos.x - viewOffsetX) / scale,
    y: (screenPos.y - viewOffsetY) / scale,
  };
}

function updateZoomDisplay() {
  zoomLevelDisplay.textContent = `${Math.round(scale * 100)}%`;
}

function zoom(delta, centerX, centerY) {
  const worldPosBeforeZoom = getWorldPos({ x: centerX, y: centerY });
  const newScale = delta < 0 ? scale * 1.1 : scale / 1.1;
  scale = Math.max(MIN_SCALE, Math.min(newScale, MAX_SCALE));
  viewOffsetX = centerX - worldPosBeforeZoom.x * scale;
  viewOffsetY = centerY - worldPosBeforeZoom.y * scale;
  updateZoomDisplay();
  draw();
}

// --- History Management ---
function saveState() {
  history = history.slice(0, historyIndex + 1);
  history.push(JSON.parse(JSON.stringify(shapes)));
  historyIndex++;
  updateHistoryButtons();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    shapes = JSON.parse(JSON.stringify(history[historyIndex]));
    selectShape(null);
    draw();
    updateHistoryButtons();
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    shapes = JSON.parse(JSON.stringify(history[historyIndex]));
    selectShape(null);
    draw();
    updateHistoryButtons();
  }
}

function updateHistoryButtons() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

// --- Tool & Inspector Setup ---
function setActiveTool(tool) {
  currentTool = tool;
  Object.keys(toolBtns).forEach((key) => {
    toolBtns[key].classList.toggle('active', key === tool);
  });
  canvas.style.cursor = tool === 'select' ? 'default' : 'crosshair';
  selectShape(null);
  draw();
}

function selectShape(shape) {
  selectedShape = shape;
  inspector.classList.toggle('hidden', !shape);
  updateInspector();
}

function updateInspector() {
  if (!selectedShape) {
    inspectorContent.innerHTML = `<p class="text-gray-500 text-sm">수정할 도형을 선택하세요.</p>`;
    return;
  }

  let content = `<div class="space-y-4"><div><label class="text-sm font-medium">이름</label><input type="text" id="inspector-name" class="inspector-input" value="${
    selectedShape.name || ''
  }"></div>`;

  switch (selectedShape.type) {
    case 'rectangle':
      content += `<div><label class="text-sm font-medium">가로 (cm)</label><input type="number" step="0.1" id="inspector-width" class="inspector-input" value="${(
        selectedShape.width / PIXELS_PER_CM
      ).toFixed(2)}"></div>
                       <div><label class="text-sm font-medium">세로 (cm)</label><input type="number" step="0.1" id="inspector-height" class="inspector-input" value="${(
                         selectedShape.height / PIXELS_PER_CM
                       ).toFixed(2)}"></div>
                       <div><label class="text-sm font-medium">회전 (°)</label><input type="number" id="inspector-rotation" class="inspector-input" value="${(
                         ((selectedShape.rotation || 0) * 180) /
                         Math.PI
                       ).toFixed(1)}"></div>`;
      break;
    case 'line':
      const length = Math.hypot(
        selectedShape.x2 - selectedShape.x1,
        selectedShape.y2 - selectedShape.y1
      );
      const angle =
        (Math.atan2(
          selectedShape.y2 - selectedShape.y1,
          selectedShape.x2 - selectedShape.x1
        ) *
          180) /
        Math.PI;
      content += `<div><label class="text-sm font-medium">길이 (cm)</label><input type="number" step="0.1" id="inspector-length" class="inspector-input" value="${(
        length / PIXELS_PER_CM
      ).toFixed(2)}"></div>
                       <div><label class="text-sm font-medium">회전 (°)</label><input type="number" id="inspector-rotation" class="inspector-input" value="${angle.toFixed(
                         1
                       )}"></div>`;
      break;
    case 'circle':
      content += `<div><label class="text-sm font-medium">지름 (cm)</label><input type="number" step="0.1" id="inspector-diameter" class="inspector-input" value="${(
        (selectedShape.radius * 2) /
        PIXELS_PER_CM
      ).toFixed(2)}"></div>`;
      break;
  }

  content += `<div><label class="text-sm font-medium">선 두께</label><input type="number" id="inspector-line-width" class="inspector-input" value="${
    selectedShape.lineWidth || 1
  }" min="1"></div>
                <div><label class="text-sm font-medium">선 색상</label><input type="color" id="inspector-stroke-color" class="inspector-color-input" value="${
                  selectedShape.strokeColor || '#000000'
                }"></div>`;

  if (selectedShape.type !== 'line') {
    content += `<div><label class="text-sm font-medium">채우기 색상</label><input type="color" id="inspector-fill-color" class="inspector-color-input" value="${
      selectedShape.fillColor || '#E5E7EB'
    }"></div>`;
  }

  content += `</div>`;
  inspectorContent.innerHTML = content;
  addInspectorListeners();
}

function addInspectorListeners() {
  const saveOnChange = () => {
    draw();
    saveState();
  };

  document.getElementById('inspector-name')?.addEventListener('change', (e) => {
    if (selectedShape) {
      selectedShape.name = e.target.value;
      saveOnChange();
    }
  });

  document
    .getElementById('inspector-width')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        selectedShape.width = parseFloat(e.target.value) * PIXELS_PER_CM;
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-height')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        selectedShape.height = parseFloat(e.target.value) * PIXELS_PER_CM;
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-rotation')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        const newAngleRad = (parseFloat(e.target.value) * Math.PI) / 180;
        if (selectedShape.type === 'rectangle') {
          selectedShape.rotation = newAngleRad;
        } else if (selectedShape.type === 'line') {
          const cx = (selectedShape.x1 + selectedShape.x2) / 2;
          const cy = (selectedShape.y1 + selectedShape.y2) / 2;
          const length = Math.hypot(
            selectedShape.x2 - selectedShape.x1,
            selectedShape.y2 - selectedShape.y1
          );
          const halfLen = length / 2;
          selectedShape.x1 = cx - halfLen * Math.cos(newAngleRad);
          selectedShape.y1 = cy - halfLen * Math.sin(newAngleRad);
          selectedShape.x2 = cx + halfLen * Math.cos(newAngleRad);
          selectedShape.y2 = cy + halfLen * Math.sin(newAngleRad);
        }
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-length')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        const newLength = parseFloat(e.target.value) * PIXELS_PER_CM;
        const angle = Math.atan2(
          selectedShape.y2 - selectedShape.y1,
          selectedShape.x2 - selectedShape.x1
        );
        selectedShape.x2 = selectedShape.x1 + newLength * Math.cos(angle);
        selectedShape.y2 = selectedShape.y1 + newLength * Math.sin(angle);
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-diameter')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        selectedShape.radius = (parseFloat(e.target.value) * PIXELS_PER_CM) / 2;
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-line-width')
    ?.addEventListener('change', (e) => {
      if (selectedShape) {
        const newWidth = parseFloat(e.target.value);
        selectedShape.lineWidth = newWidth;
        currentStyle.lineWidth = newWidth;
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-stroke-color')
    ?.addEventListener('input', (e) => {
      if (selectedShape) {
        selectedShape.strokeColor = e.target.value;
        currentStyle.strokeColor = e.target.value;
        saveOnChange();
      }
    });

  document
    .getElementById('inspector-fill-color')
    ?.addEventListener('input', (e) => {
      if (selectedShape) {
        selectedShape.fillColor = e.target.value;
        currentStyle.fillColor = e.target.value;
        saveOnChange();
      }
    });
}

// --- Drawing Functions ---
function resizeCanvas() {
  canvas.width = canvasContainer.clientWidth;
  canvas.height = canvasContainer.clientHeight;
  draw();
}

function draw() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(viewOffsetX, viewOffsetY);
  ctx.scale(scale, scale);

  shapes.forEach((shape) => {
    ctx.save();
    switch (shape.type) {
      case 'rectangle':
        drawRectangle(shape);
        break;
      case 'line':
        drawLine(shape);
        break;
      case 'circle':
        drawCircle(shape);
        break;
    }
    ctx.restore();
  });

  if (selectedShape && currentTool === 'select') {
    drawSelection(selectedShape);
  }

  if (isDrawing) {
    const worldStart = getWorldPos({ x: startX, y: startY });
    const worldEnd = getWorldPos({ x: endX, y: endY });
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([5 / scale, 5 / scale]);

    const previewShape = {
      strokeColor: '#3b82f6',
      fillColor: '#bfdbfe',
      lineWidth: 2,
      rotation: 0,
    };

    if (currentTool === 'rectangle') {
      Object.assign(previewShape, {
        x: Math.min(worldStart.x, worldEnd.x),
        y: Math.min(worldStart.y, worldEnd.y),
        width: Math.abs(worldStart.x - worldEnd.x),
        height: Math.abs(worldStart.y - worldEnd.y),
      });
      drawRectangle(previewShape);
    } else if (currentTool === 'line') {
      Object.assign(previewShape, {
        x1: worldStart.x,
        y1: worldStart.y,
        x2: worldEnd.x,
        y2: worldEnd.y,
      });
      drawLine(previewShape);
    } else if (currentTool === 'circle') {
      Object.assign(previewShape, {
        cx: worldStart.x,
        cy: worldStart.y,
        radius: Math.hypot(
          worldEnd.x - worldStart.x,
          worldEnd.y - worldStart.y
        ),
      });
      drawCircle(previewShape);
    }
    ctx.restore();
  }

  ctx.restore();
}

function drawRectangle(shape) {
  const {
    x,
    y,
    width,
    height,
    fillColor,
    strokeColor,
    lineWidth,
    name,
    rotation = 0,
  } = shape;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.fillStyle = fillColor;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = (lineWidth || 1) / scale;
  ctx.strokeRect(-width / 2, -height / 2, width, height);

  if (name) drawName(name, 0, 0);
  ctx.restore();

  if (showDimensions && shape.id) {
    const points = getHandlePositions(shape);
    if (points.tl) {
      drawDimensionText(
        `${(width / PIXELS_PER_CM).toFixed(1)} cm`,
        (points.tl.x + points.tr.x) / 2,
        (points.tl.y + points.tr.y) / 2,
        rotation
      );
      drawDimensionText(
        `${(height / PIXELS_PER_CM).toFixed(1)} cm`,
        (points.tr.x + points.br.x) / 2,
        (points.tr.y + points.br.y) / 2,
        rotation + Math.PI / 2
      );
    }
  }
}

function drawLine(shape) {
  const { x1, y1, x2, y2, strokeColor, lineWidth } = shape;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = (lineWidth || 1) / scale;
  ctx.stroke();

  if (showDimensions && shape.id) {
    const length = Math.hypot(x2 - x1, y2 - y1);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    drawDimensionText(
      `${(length / PIXELS_PER_CM).toFixed(1)} cm`,
      (x1 + x2) / 2,
      (y1 + y2) / 2,
      angle
    );
  }
}

function drawCircle(shape) {
  const { cx, cy, radius, fillColor, strokeColor, lineWidth, name } = shape;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = (lineWidth || 1) / scale;
  ctx.stroke();

  if (name) drawName(name, cx, cy);

  if (showDimensions && shape.id) {
    const diameterCm = ((radius * 2) / PIXELS_PER_CM).toFixed(1);
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.lineTo(cx + radius, cy);
    ctx.strokeStyle = '#c2410c';
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([2 / scale, 2 / scale]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawDimensionText(`Ø ${diameterCm} cm`, cx, cy);
  }
}

function drawName(name, x, y) {
  ctx.save();
  ctx.fillStyle = '#111827';
  ctx.font = `bold ${14 / scale}px "Noto Sans KR"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y);
  ctx.restore();
}

function drawDimensionText(text, x, y, angle = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#c2410c';
  ctx.font = `italic ${12 / scale}px "Noto Sans KR"`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, 0, -5 / scale);
  ctx.restore();
}

function drawSelection(shape) {
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  ctx.lineWidth = 2 / scale;
  const handles = getHandlePositions(shape);
  const handleScreenSize = HANDLE_SIZE / scale;

  ctx.setLineDash([6 / scale, 3 / scale]);
  ctx.save();
  if (shape.type === 'rectangle') {
    const centerX = shape.x + shape.width / 2;
    const centerY = shape.y + shape.height / 2;
    ctx.translate(centerX, centerY);
    ctx.rotate(shape.rotation || 0);
    ctx.strokeRect(
      -shape.width / 2,
      -shape.height / 2,
      shape.width,
      shape.height
    );
  } else if (shape.type === 'line') {
    ctx.beginPath();
    ctx.moveTo(shape.x1, shape.y1);
    ctx.lineTo(shape.x2, shape.y2);
    ctx.stroke();
  } else if (shape.type === 'circle') {
    ctx.beginPath();
    ctx.arc(shape.cx, shape.cy, shape.radius, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  ctx.setLineDash([]);

  for (const name in handles) {
    const pos = handles[name];
    if (name === 'rot') continue;
    ctx.fillRect(
      pos.x - handleScreenSize / 2,
      pos.y - handleScreenSize / 2,
      handleScreenSize,
      handleScreenSize
    );
  }

  if (handles && handles.rot) {
    const rotHandle = handles.rot;
    const centerX =
      shape.type === 'rectangle'
        ? shape.x + shape.width / 2
        : (shape.x1 + shape.x2) / 2;
    const centerY =
      shape.type === 'rectangle'
        ? shape.y + shape.height / 2
        : (shape.y1 + shape.y2) / 2;
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.lineTo(rotHandle.x, rotHandle.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rotHandle.x, rotHandle.y, handleScreenSize, 0, Math.PI * 2);
    ctx.fill();
  }
}

// --- Shape Interaction Functions ---
function isMouseInShape(mx, my, shape) {
  switch (shape.type) {
    case 'rectangle': {
      const { x, y, width, height, rotation = 0 } = shape;
      const centerX = x + width / 2;
      const centerY = y + height / 2;
      const rotatedX =
        (mx - centerX) * Math.cos(-rotation) -
        (my - centerY) * Math.sin(-rotation);
      const rotatedY =
        (mx - centerX) * Math.sin(-rotation) +
        (my - centerY) * Math.cos(-rotation);
      return Math.abs(rotatedX) < width / 2 && Math.abs(rotatedY) < height / 2;
    }
    case 'line': {
      const { x1, y1, x2, y2, lineWidth } = shape;
      const distSq = (p, v, w) => {
        let l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 == 0) return (p.x - v.x) ** 2 + (p.y - v.y) ** 2;
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return (
          (p.x - (v.x + t * (w.x - v.x))) ** 2 +
          (p.y - (v.y + t * (w.y - v.y))) ** 2
        );
      };
      const tolerance = ((lineWidth || 1) / 2 + LINE_SELECT_TOLERANCE) / scale;
      return (
        distSq({ x: mx, y: my }, { x: x1, y: y1 }, { x: x2, y: y2 }) <
        tolerance ** 2
      );
    }
    case 'circle': {
      return Math.hypot(mx - shape.cx, my - shape.cy) <= shape.radius;
    }
  }
  return false;
}

function getHandlePositions(shape) {
  if (!shape) return {};
  if (shape.type === 'rectangle') {
    const { x, y, width, height, rotation = 0 } = shape;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const halfW = width / 2;
    const halfH = height / 2;
    const unrotatedHandles = {
      tl: { x: -halfW, y: -halfH },
      tr: { x: halfW, y: -halfH },
      bl: { x: -halfW, y: halfH },
      br: { x: halfW, y: halfH },
      t: { x: 0, y: -halfH },
      b: { x: 0, y: halfH },
      l: { x: -halfW, y: 0 },
      r: { x: halfW, y: 0 },
      rot: { x: 0, y: -halfH - ROTATE_HANDLE_OFFSET / scale },
    };
    const rotatedHandles = {};
    for (const name in unrotatedHandles) {
      const pos = unrotatedHandles[name];
      rotatedHandles[name] = {
        x: pos.x * Math.cos(rotation) - pos.y * Math.sin(rotation) + centerX,
        y: pos.x * Math.sin(rotation) + pos.y * Math.cos(rotation) + centerY,
      };
    }
    return rotatedHandles;
  } else if (shape.type === 'line') {
    const { x1, y1, x2, y2 } = shape;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const perpAngle = angle - Math.PI / 2;
    return {
      start: { x: x1, y: y1 },
      end: { x: x2, y: y2 },
      rot: {
        x: cx + (ROTATE_HANDLE_OFFSET / scale) * Math.cos(perpAngle),
        y: cy + (ROTATE_HANDLE_OFFSET / scale) * Math.sin(perpAngle),
      },
    };
  } else if (shape.type === 'circle') {
    return {
      n: { x: shape.cx, y: shape.cy - shape.radius },
      s: { x: shape.cx, y: shape.cy + shape.radius },
      w: { x: shape.cx - shape.radius, y: shape.cy },
      e: { x: shape.cx + shape.radius, y: shape.cy },
    };
  }
  return {};
}

function getHandleAt(mx, my, shape) {
  const handles = getHandlePositions(shape);
  const tolerance = (HANDLE_SIZE * 1.5) / scale;
  for (const name in handles) {
    if (Math.hypot(mx - handles[name].x, my - handles[name].y) < tolerance)
      return name;
  }
  return null;
}

function moveShape(mx, my) {
  if (!selectedShape) return;
  const dx = mx - dragStart.mouse.x;
  const dy = my - dragStart.mouse.y;
  if (selectedShape.type === 'line') {
    selectedShape.x1 = dragStart.shape.x1 + dx;
    selectedShape.y1 = dragStart.shape.y1 + dy;
    selectedShape.x2 = dragStart.shape.x2 + dx;
    selectedShape.y2 = dragStart.shape.y2 + dy;
  } else if (selectedShape.type === 'circle') {
    selectedShape.cx = dragStart.shape.cx + dx;
    selectedShape.cy = dragStart.shape.cy + dy;
  } else {
    selectedShape.x = dragStart.shape.x + dx;
    selectedShape.y = dragStart.shape.y + dy;
  }
}

function resizeShape(mx, my) {
  if (!selectedShape || !resizeHandle) return;
  const minSize = MIN_SHAPE_SIZE / scale;
  if (selectedShape.type === 'rectangle') {
    const original = dragStart.shape;
    const rotation = original.rotation || 0;
    const cos = Math.cos(-rotation);
    const sin = Math.sin(-rotation);

    const dx = mx - dragStart.mouse.x;
    const dy = my - dragStart.mouse.y;

    let rotatedDx = dx * cos - dy * sin;
    let rotatedDy = dx * sin + dy * cos;

    let { x, y, width, height } = original;

    if (resizeHandle.includes('r')) width += rotatedDx;
    if (resizeHandle.includes('l')) {
      x += dx;
      width -= rotatedDx;
    }
    if (resizeHandle.includes('b')) height += rotatedDy;
    if (resizeHandle.includes('t')) {
      y += dy;
      height -= rotatedDy;
    }

    selectedShape.width = Math.max(minSize, width);
    selectedShape.height = Math.max(minSize, height);
    selectedShape.x = x;
    selectedShape.y = y;
  } else if (selectedShape.type === 'line') {
    let newMx = mx,
      newMy = my;
    if (isShiftDown) {
      const anchorPoint =
        resizeHandle === 'start'
          ? { x: selectedShape.x2, y: selectedShape.y2 }
          : { x: selectedShape.x1, y: selectedShape.y1 };
      const dx = mx - anchorPoint.x,
        dy = my - anchorPoint.y;
      const length = Math.hypot(dx, dy);
      let angle = Math.atan2(dy, dx);
      const snapAngle = Math.PI / 4;
      angle = Math.round(angle / snapAngle) * snapAngle;
      newMx = anchorPoint.x + length * Math.cos(angle);
      newMy = anchorPoint.y + length * Math.sin(angle);
    }
    if (resizeHandle === 'start') {
      selectedShape.x1 = newMx;
      selectedShape.y1 = newMy;
    } else {
      selectedShape.x2 = newMx;
      selectedShape.y2 = newMy;
    }
  } else if (selectedShape.type === 'circle') {
    switch (resizeHandle) {
      case 'n':
        selectedShape.radius = Math.max(minSize, selectedShape.cy - my);
        break;
      case 's':
        selectedShape.radius = Math.max(minSize, my - selectedShape.cy);
        break;
      case 'w':
        selectedShape.radius = Math.max(minSize, selectedShape.cx - mx);
        break;
      case 'e':
        selectedShape.radius = Math.max(minSize, mx - selectedShape.cx);
        break;
    }
  }
}

function rotateShape(mx, my) {
  if (!selectedShape) return;
  let centerX, centerY;
  if (selectedShape.type === 'rectangle') {
    centerX = selectedShape.x + selectedShape.width / 2;
    centerY = selectedShape.y + selectedShape.height / 2;
  } else if (selectedShape.type === 'line') {
    centerX = (selectedShape.x1 + selectedShape.x2) / 2;
    centerY = (selectedShape.y1 + selectedShape.y2) / 2;
  } else {
    return;
  }

  let angle = Math.atan2(my - centerY, mx - centerX);
  if (selectedShape.type === 'rectangle') angle += Math.PI / 2;
  if (isShiftDown) {
    angle = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  }

  if (selectedShape.type === 'rectangle') {
    selectedShape.rotation = angle;
  } else if (selectedShape.type === 'line') {
    const length = Math.hypot(
      selectedShape.x2 - selectedShape.x1,
      selectedShape.y2 - selectedShape.y1
    );
    const halfLen = length / 2;
    selectedShape.x1 = centerX - halfLen * Math.cos(angle);
    selectedShape.y1 = centerY - halfLen * Math.sin(angle);
    selectedShape.x2 = centerX + halfLen * Math.cos(angle);
    selectedShape.y2 = centerY + halfLen * Math.sin(angle);
  }
}

function updateCursor(mx, my) {
  let cursor = 'default';
  if (currentTool === 'select') {
    if (selectedShape) {
      const handle = getHandleAt(mx, my, selectedShape);
      if (handle) {
        if (handle === 'rot')
          cursor =
            "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M23 4v6h-6'/%3E%3Cpath d='M20.49 15a9 9 0 1 1-2.12-9.36L23 10'/%3E%3C/svg%3E\") 16 16, auto";
        else cursor = 'pointer';
      } else if (isMouseInShape(mx, my, selectedShape)) {
        cursor = 'move';
      }
    }
  } else {
    cursor = 'crosshair';
  }
  canvas.style.cursor = cursor;
}

// --- Event Listeners ---
Object.keys(toolBtns).forEach((key) => {
  toolBtns[key].className =
    'tool-btn bg-gray-200 hover:bg-gray-300 text-gray-800 py-2 px-4 rounded-md transition';
  toolBtns[key].addEventListener('click', () => setActiveTool(key));
});

showDimensionsToggle.addEventListener('change', (e) => {
  showDimensions = e.target.checked;
  draw();
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Shift') {
    isShiftDown = true;
  }
  if (document.activeElement.tagName.toLowerCase() === 'input') return;

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedShape) {
    e.preventDefault();
    shapes = shapes.filter((s) => s.id !== selectedShape.id);
    selectShape(null);
    saveState();
    draw();
    showToast('도형이 삭제되었습니다.');
  } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') isShiftDown = false;
});

deleteShapeBtn.addEventListener('click', () => {
  if (selectedShape) {
    shapes = shapes.filter((s) => s.id !== selectedShape.id);
    selectShape(null);
    saveState();
    draw();
    showToast('선택된 도형이 삭제되었습니다.');
  } else {
    showToast('삭제할 도형을 먼저 선택하세요.');
  }
});

saveBtn.addEventListener('click', () => {
  const data = JSON.stringify(shapes, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'drawing.json';
  a.click();
  URL.revokeObjectURL(url);
  showToast('도면이 저장되었습니다.');
});

loadBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const loadedShapes = JSON.parse(event.target.result);
        if (Array.isArray(loadedShapes)) {
          shapes = loadedShapes;
          selectShape(null);
          history = [];
          historyIndex = -1;
          saveState();
          draw();
          showToast('도면을 불러왔습니다.');
        } else {
          showToast('잘못된 파일 형식입니다.');
        }
      } catch (err) {
        showToast('파일을 불러오는 중 오류가 발생했습니다.');
        console.error(err);
      }
    };
    reader.readAsText(file);
  };
  input.click();
});

// Firebase 관련 이벤트 리스너
saveToCloudBtn.addEventListener('click', saveToCloud);
loadFromCloudBtn.addEventListener('click', loadFromCloud);

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoom(e.deltaY, getScreenPos(e).x, getScreenPos(e).y);
});

zoomInBtn.addEventListener('click', () =>
  zoom(-1, canvas.width / 2, canvas.height / 2)
);
zoomOutBtn.addEventListener('click', () =>
  zoom(1, canvas.width / 2, canvas.height / 2)
);
zoomResetBtn.addEventListener('click', () => {
  scale = 1.0;
  viewOffsetX = 0;
  viewOffsetY = 0;
  updateZoomDisplay();
  draw();
});

canvas.addEventListener('mousedown', (e) => {
  const screenPos = getScreenPos(e);
  if (e.button === 1) {
    isPanning = true;
    lastPanPoint = screenPos;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
    return;
  }
  const worldPos = getWorldPos(screenPos);
  startX = screenPos.x;
  startY = screenPos.y;

  if (currentTool === 'select') {
    if (selectedShape) {
      const handle = getHandleAt(worldPos.x, worldPos.y, selectedShape);
      if (handle) {
        if (handle === 'rot') {
          isRotating = true;
        } else {
          isResizing = true;
          resizeHandle = handle;
        }
        dragStart.mouse = worldPos;
        dragStart.shape = JSON.parse(JSON.stringify(selectedShape));
        return;
      }
    }
    let clickedShape = null;
    for (let i = shapes.length - 1; i >= 0; i--) {
      if (isMouseInShape(worldPos.x, worldPos.y, shapes[i])) {
        clickedShape = shapes[i];
        break;
      }
    }
    selectShape(clickedShape);
    if (selectedShape) {
      isDragging = true;
      dragStart.mouse = worldPos;
      dragStart.shape = JSON.parse(JSON.stringify(selectedShape));
    }
  } else {
    isDrawing = true;
  }
});

canvas.addEventListener('mousemove', (e) => {
  const screenPos = getScreenPos(e);
  endX = screenPos.x;
  endY = screenPos.y;

  if (isPanning) {
    viewOffsetX += screenPos.x - lastPanPoint.x;
    viewOffsetY += screenPos.y - lastPanPoint.y;
    lastPanPoint = screenPos;
  } else if (currentTool === 'select') {
    const worldPos = getWorldPos(screenPos);
    if (isRotating) {
      rotateShape(worldPos.x, worldPos.y);
    } else if (isResizing) {
      resizeShape(worldPos.x, worldPos.y);
    } else if (isDragging) {
      moveShape(worldPos.x, worldPos.y);
    } else {
      updateCursor(worldPos.x, worldPos.y);
    }
  }

  if (isDrawing || isResizing || isDragging || isPanning || isRotating) draw();
});

canvas.addEventListener('mouseup', (e) => {
  const actionOccurred = isDrawing || isDragging || isResizing || isRotating;

  if (isPanning) {
    isPanning = false;
    updateCursor(
      getWorldPos(getScreenPos(e)).x,
      getWorldPos(getScreenPos(e)).y
    );
  } else if (isDrawing) {
    const worldStart = getWorldPos({ x: startX, y: startY });
    const worldEnd = getWorldPos(getScreenPos(e));
    const newShape = { id: Date.now(), ...currentStyle, rotation: 0 };
    let newName = '';

    switch (currentTool) {
      case 'rectangle':
        newName = prompt('사각형의 이름을 입력하세요:', '');
        Object.assign(newShape, {
          type: 'rectangle',
          name: newName || '이름 없음',
          x: Math.min(worldStart.x, worldEnd.x),
          y: Math.min(worldStart.y, worldEnd.y),
          width: Math.abs(worldStart.x - worldEnd.x),
          height: Math.abs(worldStart.y - worldEnd.y),
        });
        if (
          newShape.width > MIN_SHAPE_SIZE / scale &&
          newShape.height > MIN_SHAPE_SIZE / scale
        ) {
          shapes.push(newShape);
        }
        break;
      case 'line':
        Object.assign(newShape, {
          type: 'line',
          name: '',
          x1: worldStart.x,
          y1: worldStart.y,
          x2: worldEnd.x,
          y2: worldEnd.y,
        });
        shapes.push(newShape);
        break;
      case 'circle':
        newName = prompt('원의 이름을 입력하세요:', '');
        Object.assign(newShape, {
          type: 'circle',
          name: newName || '이름 없음',
          cx: worldStart.x,
          cy: worldStart.y,
          radius: Math.hypot(
            worldEnd.x - worldStart.x,
            worldEnd.y - worldStart.y
          ),
        });
        if (newShape.radius > MIN_SHAPE_SIZE / 2 / scale) {
          shapes.push(newShape);
        }
        break;
    }
    setActiveTool('select');
  }

  if (actionOccurred) {
    updateInspector();
    saveState();
  }

  isDrawing = false;
  isDragging = false;
  isResizing = false;
  isPanning = false;
  isRotating = false;
  resizeHandle = null;
  draw();
});

canvas.addEventListener('dblclick', (e) => {
  if (currentTool === 'select' && selectedShape) {
    const newName = prompt('새로운 이름을 입력하세요:', selectedShape.name);
    if (newName !== null) {
      selectedShape.name = newName.trim() || '이름 없음';
      draw();
      saveState();
      updateInspector();
    }
  }
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

// --- Initialization ---
window.addEventListener('resize', resizeCanvas);

function init() {
  resizeCanvas();
  setActiveTool('select');
  saveState();
  showToast('안녕하세요! 도면 편집기를 시작합니다.');
}

init();
