// 캔버스 및 컨텍스트 설정
const canvas = document.getElementById("drawingCanvas");
const ctx = canvas.getContext("2d");
const customCursor = document.getElementById("customCursor");

// 임시 캔버스 생성
const tempCanvas = document.createElement("canvas");
tempCanvas.width = canvas.width;
tempCanvas.height = canvas.height;
const tempCtx = tempCanvas.getContext("2d");

// 버튼 요소들
const moveBtn = document.getElementById("moveBtn");
const drawBtn = document.getElementById("drawBtn");
const newPatientBtn = document.getElementById("newPatientBtn");
const undoBtn = document.getElementById("undoBtn");
const redoBtn = document.getElementById("redoBtn");
const resetBtn = document.getElementById("resetBtn");

// 상태 변수들
let isDrawingMode = false;
let isMovingCursor = false;
let cursorOffsetX = 0;
let cursorOffsetY = 0;
let currentCursorX = window.innerWidth / 2;
let currentCursorY = window.innerHeight / 2;
let lassoPoints = [];
let allLassoRegions = [];
let blobImage = null;
let blobEdges = [];
let lastMagneticPoint = null;

// Undo/Redo를 위한 변수들
let history = [];
let historyIndex = -1;
const maxHistoryLength = 20;

// 유틸리티 함수들
function addButtonListeners(button, clickHandler) {
  button.addEventListener("click", clickHandler);
  button.addEventListener("touchend", function (e) {
    e.preventDefault();
    clickHandler.call(this, e);
  });
}

function stopPropagation(e) {
  e.stopPropagation();
}

function getEventCoordinates(e) {
  let x, y;
  if (e.type.startsWith("touch")) {
    const touch = e.touches[0] || e.changedTouches[0];
    x = touch.clientX;
    y = touch.clientY;
  } else {
    x = e.clientX;
    y = e.clientY;
  }

  x += window.pageXOffset;
  y += window.pageYOffset;

  return { x, y };
}

function setCursorPosition(x, y) {
  customCursor.style.left = `${x - window.pageXOffset}px`;
  customCursor.style.top = `${y - window.pageYOffset}px`;
  currentCursorX = x;
  currentCursorY = y;
}

// 그리기 관련 함수들
function drawRandomBlob() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const maxDimension = Math.min(canvas.width, canvas.height) / 2;
  const minDimension = maxDimension / 4;

  const width =
    Math.floor(Math.random() * (maxDimension - minDimension + 1)) +
    minDimension;
  const height =
    Math.floor(Math.random() * (maxDimension - minDimension + 1)) +
    minDimension;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;

  ctx.beginPath();

  const points = [];
  const numPoints = 12;

  for (let i = 0; i < numPoints; i++) {
    const angle = (i / numPoints) * 2 * Math.PI;
    const radiusX = width / 2 + Math.random() * 75 - 37.5;
    const radiusY = height / 2 + Math.random() * 75 - 37.5;
    const x = centerX + radiusX * Math.cos(angle);
    const y = centerY + radiusY * Math.sin(angle);
    points.push({ x, y });
  }

  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const controlX = (current.x + next.x) / 2 + Math.random() * 30 - 15;
    const controlY = (current.y + next.y) / 2 + Math.random() * 30 - 15;
    ctx.quadraticCurveTo(current.x, current.y, controlX, controlY);
  }

  ctx.closePath();
  ctx.fillStyle = "#84FF66";
  ctx.fill();

  blobImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
  blobEdges = detectBlobEdges();
  allLassoRegions = [];
  history = [blobImage];
  historyIndex = 0;
  updateButtonStates();
}

// 블롭 엣지 감지 함수
function detectBlobEdges() {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const edges = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      if (
        data[idx + 3] > 0 &&
        (data[idx - 4 + 3] === 0 ||
          data[idx + 4 + 3] === 0 ||
          data[idx - width * 4 + 3] === 0 ||
          data[idx + width * 4 + 3] === 0)
      ) {
        edges.push({ x, y });
      }
    }
  }
  return edges;
}

// 가장 가까운 엣지 포인트 찾기
function findNearestEdgePoint(x, y, edges) {
  let nearest = null;
  let minDistance = Infinity;
  for (let edge of edges) {
    const distance = Math.sqrt((edge.x - x) ** 2 + (edge.y - y) ** 2);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = edge;
    }
  }
  return minDistance < 20 ? nearest : null; // 20픽셀 내에 있을 때만 스냅
}

// 영역을 병합하는 함수
function mergeRegions(regions) {
  const mergeCanvas = document.createElement("canvas");
  mergeCanvas.width = ctx.canvas.width;
  mergeCanvas.height = ctx.canvas.height;
  const mergeCtx = mergeCanvas.getContext("2d");

  mergeCtx.fillStyle = "rgba(0, 106, 255, 0.5)";
  regions.forEach((region) => {
    mergeCtx.beginPath();
    mergeCtx.moveTo(region[0].x, region[0].y);
    for (let i = 1; i < region.length; i++) {
      mergeCtx.lineTo(region[i].x, region[i].y);
    }
    mergeCtx.closePath();
    mergeCtx.fill();
  });

  return mergeCanvas;
}

// 상호작용 함수들
function startInteraction(e) {
  e.preventDefault();
  const { x, y } = getEventCoordinates(e);
  if (isDrawingMode) {
    isMovingCursor = true;
    cursorOffsetX = x - currentCursorX;
    cursorOffsetY = y - currentCursorY;
    lassoPoints = [];
    tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.beginPath();

    const startX = currentCursorX;
    const startY = currentCursorY;

    const magneticPoint = findNearestEdgePoint(startX, startY, blobEdges);
    if (magneticPoint) {
      tempCtx.moveTo(magneticPoint.x, magneticPoint.y);
      lassoPoints.push(magneticPoint);
      lastMagneticPoint = magneticPoint;
    } else {
      tempCtx.moveTo(startX, startY);
      lassoPoints.push({ x: startX, y: startY });
      lastMagneticPoint = null;
    }
  } else {
    isMovingCursor = true;
    cursorOffsetX = x - currentCursorX;
    cursorOffsetY = y - currentCursorY;
  }
}

function moveInteraction(e) {
  e.preventDefault();
  if (isMovingCursor) {
    const { x, y } = getEventCoordinates(e);
    const newX = x - cursorOffsetX;
    const newY = y - cursorOffsetY;

    if (isDrawingMode) {
      const magneticPoint = findNearestEdgePoint(newX, newY, blobEdges);
      if (
        magneticPoint &&
        (!lastMagneticPoint ||
          Math.sqrt(
            (magneticPoint.x - lastMagneticPoint.x) ** 2 +
              (magneticPoint.y - lastMagneticPoint.y) ** 2
          ) > 5)
      ) {
        tempCtx.lineTo(magneticPoint.x, magneticPoint.y);
        lassoPoints.push(magneticPoint);
        lastMagneticPoint = magneticPoint;
      } else if (!magneticPoint) {
        tempCtx.lineTo(newX, newY);
        lassoPoints.push({ x: newX, y: newY });
        lastMagneticPoint = null;
      }

      // 메인 캔버스에 모든 내용 그리기
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.putImageData(blobImage, 0, 0);

      // 이전에 완성된 영역들 그리기
      ctx.beginPath();
      allLassoRegions.forEach((region) => {
        ctx.moveTo(region[0].x, region[0].y);
        for (let i = 1; i < region.length; i++) {
          ctx.lineTo(region[i].x, region[i].y);
        }
        ctx.closePath();
      });
      ctx.fillStyle = "rgba(0, 106, 255, 0.5)";
      ctx.fill();

      // 현재 그리고 있는 선 그리기
      ctx.beginPath();
      if (lassoPoints.length > 0) {
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y);
        for (let i = 1; i < lassoPoints.length; i++) {
          ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y);
        }
      }
      ctx.strokeStyle = "rgba(0, 106, 255, 0.8)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    setCursorPosition(newX, newY);
  }
}

function endInteraction(e) {
  e.preventDefault();
  if (isDrawingMode && lassoPoints.length > 2) {
    allLassoRegions.push([...lassoPoints]);

    // 모든 영역을 병합하여 그리기
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.putImageData(blobImage, 0, 0);

    ctx.beginPath();
    allLassoRegions.forEach((region) => {
      ctx.moveTo(region[0].x, region[0].y);
      for (let i = 1; i < region.length; i++) {
        ctx.lineTo(region[i].x, region[i].y);
      }
      ctx.closePath();
    });
    ctx.fillStyle = "rgba(0, 106, 255, 0.5)";
    ctx.fill();

    saveState();
  }
  isMovingCursor = false;
  lassoPoints = [];
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);
}

// Undo/Redo 함수들
function saveState() {
  historyIndex++;
  if (historyIndex < history.length) {
    history = history.slice(0, historyIndex);
  }
  history.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (history.length > maxHistoryLength) {
    history.shift();
    historyIndex--;
  }
  updateButtonStates();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    ctx.putImageData(history[historyIndex], 0, 0);
    updateButtonStates();
  }
}

function redo() {
  if (historyIndex < history.length - 1) {
    historyIndex++;
    ctx.putImageData(history[historyIndex], 0, 0);
    updateButtonStates();
  }
}

function updateButtonStates() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= history.length - 1;
}

// Reset 함수
function resetDrawing() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.putImageData(blobImage, 0, 0);
  allLassoRegions = [];
  history = [blobImage];
  historyIndex = 0;
  updateButtonStates();
}

// 캔버스 크기 업데이트 함수
function updateCanvasSize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  tempCanvas.width = canvas.width;
  tempCanvas.height = canvas.height;
  drawRandomBlob();
}

// 이벤트 리스너 설정
addButtonListeners(moveBtn, function () {
  isDrawingMode = false;
  moveBtn.classList.add("active");
  drawBtn.classList.remove("active");
  canvas.style.cursor = "default";
});

addButtonListeners(drawBtn, function () {
  isDrawingMode = true;
  drawBtn.classList.add("active");
  moveBtn.classList.remove("active");
  canvas.style.cursor = "crosshair";
});

addButtonListeners(newPatientBtn, function () {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  setCursorPosition(window.innerWidth / 2, window.innerHeight / 2);
  drawRandomBlob();
  isDrawingMode = false;
  moveBtn.classList.add("active");
  drawBtn.classList.remove("active");
  canvas.style.cursor = "default";
});

addButtonListeners(undoBtn, undo);
addButtonListeners(redoBtn, redo);
addButtonListeners(resetBtn, resetDrawing);

[moveBtn, drawBtn, newPatientBtn, undoBtn, redoBtn, resetBtn].forEach((btn) => {
  btn.addEventListener("touchstart", stopPropagation);
  btn.addEventListener("touchmove", stopPropagation);
  btn.addEventListener("touchend", stopPropagation);
});

canvas.addEventListener("mousedown", startInteraction);
canvas.addEventListener("touchstart", startInteraction, { passive: false });

document.addEventListener("mousemove", moveInteraction);
document.addEventListener("touchmove", moveInteraction, { passive: false });

document.addEventListener("mouseup", endInteraction);
document.addEventListener("touchend", endInteraction, { passive: false });

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("resize", updateCanvasSize);

window.addEventListener("load", () => {
  // 캔버스 크기 업데이트
  updateCanvasSize();

  // 커서 초기 위치 설정
  setCursorPosition(window.innerWidth / 2, window.innerHeight / 2);

  // 초기 블롭 그리기
  drawRandomBlob();

  // 초기 모드 설정 (이동 모드)
  isDrawingMode = false;
  moveBtn.classList.add("active");
  drawBtn.classList.remove("active");
  canvas.style.cursor = "default";

  // 버튼 상태 업데이트
  updateButtonStates();

  // 임시 캔버스 초기화
  tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height);

  // 히스토리 초기화
  history = [blobImage];
  historyIndex = 0;

  // 라쏘 영역 초기화
  allLassoRegions = [];
});

// 윈도우 리사이즈 이벤트 리스너
window.addEventListener("resize", () => {
  updateCanvasSize();
  setCursorPosition(window.innerWidth / 2, window.innerHeight / 2);
});
