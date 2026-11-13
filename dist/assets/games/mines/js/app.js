(function runClearFieldApp() {
  "use strict";

  const LONG_PRESS_MS = 520;
  const MIN_COLUMNS = 4;
  const MAX_COLUMNS = 20;
  const MIN_ROWS = 4;
  const MAX_ROWS = 30;
  const MAX_MINE_RATIO = 0.32;

  const elements = {};
  let game = null;
  let currentConfig = null;
  let activeTool = "reveal";
  let tileElements = [];
  let timerId = null;
  let elapsedSeconds = 0;
  let longPressTimer = null;
  let longPressIndex = null;
  let pressOrigin = null;
  let largeCells = false;
  let resultTimer = null;
  let suppressNextClick = false;
  let suppressResetTimer = null;
  let resizeFrame = null;

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    updateCustomForm();
  }

  function cacheElements() {
    elements.homeScreen = document.querySelector("#home-screen");
    elements.gameScreen = document.querySelector("#game-screen");
    elements.customForm = document.querySelector("#custom-form");
    elements.customError = document.querySelector("#custom-error");
    elements.squareFields = document.querySelector("#square-fields");
    elements.rectangleFields = document.querySelector("#rectangle-fields");
    elements.squareSize = document.querySelector("#square-size");
    elements.customColumns = document.querySelector("#custom-columns");
    elements.customRows = document.querySelector("#custom-rows");
    elements.customMines = document.querySelector("#custom-mines");
    elements.mineRange = document.querySelector("#mine-range");
    elements.board = document.querySelector("[data-board]");
    elements.boardViewport = document.querySelector("[data-board-viewport]");
    elements.cellSize = document.querySelector("[data-cell-size]");
    elements.scrollHint = document.querySelector("#board-scroll-hint");
    elements.boardSize = document.querySelector("[data-board-size]");
    elements.boardSummary = document.querySelector("[data-board-summary]");
    elements.minesLeft = document.querySelector("[data-mines-left]");
    elements.timer = document.querySelector("[data-timer]");
    elements.gameStatus = document.querySelector("[data-game-status]");
    elements.announcement = document.querySelector("#game-announcement");
    elements.resultDialog = document.querySelector("#result-dialog");
    elements.resultMark = document.querySelector("[data-result-mark]");
    elements.resultEyebrow = document.querySelector("[data-result-eyebrow]");
    elements.resultTitle = document.querySelector("[data-result-title]");
    elements.resultCopy = document.querySelector("[data-result-copy]");
  }

  function bindEvents() {
    document.querySelectorAll("[data-quick]").forEach((button) => {
      button.addEventListener("click", () => {
        const [rows, columns, mines] = button.dataset.quick.split(",").map(Number);
        startGame({ rows, columns, mines });
      });
    });

    document.querySelectorAll('input[name="shape"]').forEach((input) => {
      input.addEventListener("change", updateCustomForm);
    });

    [elements.squareSize, elements.customColumns, elements.customRows].forEach((input) => {
      input.addEventListener("input", updateCustomForm);
    });

    elements.customMines.addEventListener("input", () => {
      elements.customMines.dataset.edited = "true";
      updateMineRange({ preserveMineValue: true });
    });

    elements.customForm.addEventListener("submit", handleCustomSubmit);
    elements.board.addEventListener("click", handleBoardClick);
    elements.board.addEventListener("contextmenu", handleContextMenu);
    elements.board.addEventListener("keydown", handleBoardKeyDown);
    elements.board.addEventListener("focusin", handleBoardFocus);
    elements.board.addEventListener("pointerdown", handlePointerDown);
    elements.board.addEventListener("pointermove", handlePointerMove);
    elements.board.addEventListener("pointerup", cancelLongPress);
    elements.board.addEventListener("pointercancel", cancelLongPress);
    elements.board.addEventListener("pointerleave", cancelLongPress);

    elements.cellSize.addEventListener("click", () => {
      largeCells = !largeCells;
      elements.cellSize.setAttribute("aria-pressed", String(largeCells));
      syncCellSize();
    });

    document.querySelectorAll("[data-tool]").forEach((button) => {
      button.addEventListener("click", () => setActiveTool(button.dataset.tool));
    });

    document.querySelectorAll("[data-restart]").forEach((button) => {
      button.addEventListener("click", restartGame);
    });

    document.querySelectorAll("[data-back-home], [data-home-link], [data-result-home]").forEach((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        showHome();
      });
    });

    document.querySelector("[data-result-restart]").addEventListener("click", restartGame);

    window.addEventListener("resize", () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(syncCellSize);
    });

    document.addEventListener("keydown", handleKeyboardShortcut);
  }

  function handleCustomSubmit(event) {
    event.preventDefault();
    const config = readCustomConfig();
    if (config) startGame(config);
  }

  function readCustomConfig() {
    const shape = getSelectedShape();
    const isSquare = shape === "square";
    const rows = parseWholeNumber(isSquare ? elements.squareSize.value : elements.customRows.value);
    const columns = parseWholeNumber(isSquare ? elements.squareSize.value : elements.customColumns.value);
    const mines = parseWholeNumber(elements.customMines.value);

    const errors = [];
    if (columns === null || columns < MIN_COLUMNS || columns > MAX_COLUMNS) {
      errors.push(`width must be a whole number between ${MIN_COLUMNS} and ${MAX_COLUMNS}`);
    }
    if (rows === null || rows < MIN_ROWS || rows > MAX_ROWS) {
      errors.push(`height must be a whole number between ${MIN_ROWS} and ${MAX_ROWS}`);
    }

    if (errors.length === 0) {
      const maxMines = getMaxMines(rows, columns);
      if (mines === null || mines < 1 || mines > maxMines) {
        errors.push(`the number of mines must be a whole number between 1 and ${maxMines}`);
      }
    }

    if (errors.length > 0) {
      showFormError(`Check your settings: ${errors.join("; ")}.`);
      return null;
    }

    hideFormError();
    return { rows, columns, mines };
  }

  function updateCustomForm() {
    const isSquare = getSelectedShape() === "square";
    elements.squareFields.hidden = !isSquare;
    elements.rectangleFields.hidden = isSquare;
    hideFormError();
    updateMineRange({ preserveMineValue: elements.customMines.dataset.edited === "true" });
  }

  function updateMineRange({ preserveMineValue = false } = {}) {
    const dimensions = getDraftDimensions();
    if (!dimensions) return;

    const { rows, columns } = dimensions;
    const maxMines = getMaxMines(rows, columns);
    const suggestedMines = getSuggestedMines(rows, columns);
    const currentValue = parseWholeNumber(elements.customMines.value);

    elements.customMines.max = String(maxMines);
    if (!preserveMineValue) {
      elements.customMines.value = String(suggestedMines);
    } else if (currentValue > maxMines) {
      elements.customMines.value = String(maxMines);
    }

    elements.mineRange.textContent = `Suggested: ${suggestedMines} · maximum: ${maxMines}`;
  }

  function getDraftDimensions() {
    const isSquare = getSelectedShape() === "square";
    const draftRows = parseWholeNumber(isSquare ? elements.squareSize.value : elements.customRows.value);
    const draftColumns = parseWholeNumber(isSquare ? elements.squareSize.value : elements.customColumns.value);

    if (draftRows === null || draftColumns === null) return null;

    return {
      rows: clamp(draftRows, MIN_ROWS, MAX_ROWS),
      columns: clamp(draftColumns, MIN_COLUMNS, MAX_COLUMNS),
    };
  }

  function getSelectedShape() {
    return document.querySelector('input[name="shape"]:checked').value;
  }

  function getSuggestedMines(rows, columns) {
    return clamp(Math.round(rows * columns * 0.16), 1, getMaxMines(rows, columns));
  }

  function getMaxMines(rows, columns) {
    return Math.max(1, Math.min(rows * columns - 1, Math.floor(rows * columns * MAX_MINE_RATIO)));
  }

  function startGame(config) {
    cancelLongPress();
    window.clearTimeout(resultTimer);
    currentConfig = { ...config };
    suppressNextClick = false;
    if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer);
    suppressResetTimer = null;
    game = new ClearField.Game(config);
    resetTimer();
    setActiveTool("reveal");
    buildBoard();
    renderGame();

    elements.homeScreen.hidden = true;
    elements.gameScreen.hidden = false;
    document.body.classList.add("is-playing");
    elements.boardViewport.scrollLeft = 0;
    closeResultDialog();
    tileElements[0]?.focus({ preventScroll: true });

    requestAnimationFrame(() => {
      syncCellSize();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  }

  function restartGame() {
    if (!currentConfig) return;
    startGame(currentConfig);
  }

  function showHome() {
    stopTimer();
    window.clearTimeout(resultTimer);
    cancelLongPress();
    closeResultDialog();
    game = null;
    tileElements = [];
    elements.board.replaceChildren();
    elements.gameScreen.hidden = true;
    elements.homeScreen.hidden = false;
    document.body.classList.remove("is-playing");
    document.querySelector("[data-quick]").focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  function buildBoard() {
    const fragment = document.createDocumentFragment();
    tileElements = game.cells.map((cell) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tile";
      button.dataset.index = String(cell.index);
      button.tabIndex = cell.index === 0 ? 0 : -1;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-rowindex", String(cell.row + 1));
      button.setAttribute("aria-colindex", String(cell.column + 1));
      fragment.append(button);
      return button;
    });

    elements.board.replaceChildren(fragment);
    elements.board.style.setProperty("--columns", String(game.columns));
    elements.board.setAttribute("aria-rowcount", String(game.rows));
    elements.board.setAttribute("aria-colcount", String(game.columns));
  }

  function handleBoardClick(event) {
    const tile = event.target.closest(".tile");
    if (!tile || !game || game.isOver) return;

    if (suppressNextClick) {
      clearSuppressedActivation();
      return;
    }

    performTileAction(Number(tile.dataset.index), activeTool);
  }

  function handleContextMenu(event) {
    const tile = event.target.closest(".tile");
    if (!tile || !game || game.isOver) return;

    event.preventDefault();
    cancelLongPress();
    if (suppressNextClick) return;
    performTileAction(Number(tile.dataset.index), "flag");
  }

  function handleBoardKeyDown(event) {
    const tile = event.target.closest(".tile");
    if (!tile || !game) return;

    const index = Number(tile.dataset.index);
    const cell = game.getCell(index);
    if (!cell) return;

    let targetRow = cell.row;
    let targetColumn = cell.column;

    switch (event.key) {
      case "ArrowUp":
        targetRow -= 1;
        break;
      case "ArrowDown":
        targetRow += 1;
        break;
      case "ArrowLeft":
        targetColumn -= 1;
        break;
      case "ArrowRight":
        targetColumn += 1;
        break;
      case "Home":
        targetColumn = 0;
        break;
      case "End":
        targetColumn = game.columns - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    targetRow = clamp(targetRow, 0, game.rows - 1);
    targetColumn = clamp(targetColumn, 0, game.columns - 1);
    focusTile(targetRow * game.columns + targetColumn);
  }

  function handleBoardFocus(event) {
    const tile = event.target.closest(".tile");
    if (!tile) return;
    tileElements.forEach((element) => {
      element.tabIndex = element === tile ? 0 : -1;
    });
  }

  function focusTile(index) {
    const tile = tileElements[index];
    if (!tile) return;
    tile.tabIndex = 0;
    tile.focus({ preventScroll: false });
  }

  function handlePointerDown(event) {
    cancelLongPress();
    if (event.pointerType === "mouse" || !event.isPrimary || activeTool === "flag" || !game || game.isOver) return;

    const tile = event.target.closest(".tile");
    if (!tile) return;

    pressOrigin = { x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    longPressIndex = Number(tile.dataset.index);
    longPressTimer = window.setTimeout(() => {
      suppressFollowUpActivation();
      performTileAction(longPressIndex, "flag");
      if (typeof navigator.vibrate === "function") navigator.vibrate(18);
      longPressTimer = null;
      longPressIndex = null;
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event) {
    if (!pressOrigin || event.pointerId !== pressOrigin.pointerId) return;
    if (Math.hypot(event.clientX - pressOrigin.x, event.clientY - pressOrigin.y) > 10) {
      cancelLongPress();
    }
  }

  function suppressFollowUpActivation() {
    suppressNextClick = true;
    if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer);
    suppressResetTimer = null;
  }

  function clearSuppressedActivation() {
    suppressNextClick = false;
    if (suppressResetTimer !== null) window.clearTimeout(suppressResetTimer);
    suppressResetTimer = null;
  }

  function cancelLongPress() {
    if (longPressTimer !== null) window.clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressIndex = null;
    pressOrigin = null;
    // Keep the release click suppressed even when a finger stays down for a long time.
    if (suppressNextClick && suppressResetTimer === null) {
      suppressResetTimer = window.setTimeout(clearSuppressedActivation, 900);
    }
  }

  function performTileAction(index, tool) {
    if (!game || game.isOver) return;

    const previousStatus = game.status;
    const result = tool === "flag" ? game.toggleFlag(index) : game.reveal(index);

    if (previousStatus === ClearField.STATUS.READY && game.status === ClearField.STATUS.PLAYING) {
      startTimer();
    }

    renderGame();

    if (result.reason === "flag-limit") {
      announce("All available flags have been placed.");
    } else if (result.reason === "flagged") {
      announce("Flag placed.");
    } else if (result.reason === "unflagged") {
      announce("Flag removed.");
    }

    if (game.isOver) {
      stopTimer();
      resultTimer = window.setTimeout(showResult, 240);
    }
  }

  function renderGame() {
    if (!game) return;

    elements.boardSize.textContent = `${game.columns} × ${game.rows}`;
    elements.boardSummary.textContent = `${game.columns} × ${game.rows} · ${game.mines} ${game.mines === 1 ? "mine" : "mines"}`;
    elements.minesLeft.textContent = String(game.minesRemaining);
    renderStatus();

    game.cells.forEach((cell, index) => {
      const tile = tileElements[index];
      const visual = getCellVisual(cell);

      tile.dataset.state = visual.state;
      tile.textContent = visual.text;
      tile.setAttribute("aria-label", getCellLabel(cell));
      tile.setAttribute("aria-disabled", String(game.isOver));

      if (cell.isRevealed && !cell.isMine && cell.adjacentMines > 0) {
        tile.dataset.number = String(cell.adjacentMines);
      } else {
        delete tile.dataset.number;
      }
    });
  }

  function getCellVisual(cell) {
    if (cell.isExploded) return { state: "exploded", text: "✹" };
    if (cell.isWrongFlag) return { state: "wrong-flag", text: "×" };
    if (cell.isFlagged) return { state: "flagged", text: "⚑" };
    if (cell.isMine && cell.isRevealed) return { state: "mine", text: "✹" };
    if (cell.isRevealed) {
      return { state: "revealed", text: cell.adjacentMines === 0 ? "" : String(cell.adjacentMines) };
    }
    return { state: "hidden", text: "" };
  }

  function getCellLabel(cell) {
    const position = `row ${cell.row + 1}, column ${cell.column + 1}`;
    if (cell.isExploded) return `Exploded mine, ${position}`;
    if (cell.isWrongFlag) return `Incorrect flag, ${position}`;
    if (cell.isFlagged) return `Flagged cell, ${position}`;
    if (cell.isMine && cell.isRevealed) return `Mine, ${position}`;
    if (!cell.isRevealed) return `Hidden cell, ${position}`;
    if (cell.adjacentMines === 0) return `Empty cell, ${position}`;
    return `${cell.adjacentMines} adjacent ${cell.adjacentMines === 1 ? "mine" : "mines"}, ${position}`;
  }

  function renderStatus() {
    const labels = {
      [ClearField.STATUS.READY]: "First move",
      [ClearField.STATUS.PLAYING]: "Playing",
      [ClearField.STATUS.WON]: "Solved",
      [ClearField.STATUS.LOST]: "Game over",
    };

    elements.gameStatus.textContent = labels[game.status];
    elements.gameStatus.dataset.state = game.status;
  }

  function setActiveTool(tool) {
    if (tool !== "reveal" && tool !== "flag") return;
    activeTool = tool;

    document.querySelectorAll("[data-tool]").forEach((button) => {
      const isActive = button.dataset.tool === activeTool;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-pressed", String(isActive));
    });

    announce(tool === "flag" ? "Flag mode active." : "Reveal mode active.");
  }

  function handleKeyboardShortcut(event) {
    if (elements.gameScreen.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.target.matches("input, textarea, select")) return;

    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      setActiveTool("flag");
    } else if (event.key.toLowerCase() === "r") {
      event.preventDefault();
      setActiveTool("reveal");
    } else if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      restartGame();
    }
  }

  function startTimer() {
    if (timerId !== null) return;
    timerId = window.setInterval(() => {
      elapsedSeconds += 1;
      elements.timer.textContent = formatTime(elapsedSeconds);
    }, 1000);
  }

  function stopTimer() {
    if (timerId !== null) window.clearInterval(timerId);
    timerId = null;
  }

  function resetTimer() {
    stopTimer();
    elapsedSeconds = 0;
    elements.timer.textContent = "00:00";
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function showResult() {
    if (!game || !game.isOver) return;

    const won = game.status === ClearField.STATUS.WON;
    elements.resultDialog.dataset.result = won ? "won" : "lost";
    elements.resultMark.textContent = won ? "✓" : "!";
    elements.resultEyebrow.textContent = won ? "Field cleared" : "Mine triggered";
    elements.resultTitle.textContent = won ? "You solved it!" : "So close.";
    elements.resultCopy.textContent = won
      ? `${game.columns} × ${game.rows} board, ${game.mines} ${game.mines === 1 ? "mine" : "mines"}, ${formatTime(elapsedSeconds)}. Your result is not saved.`
      : "The first reveal is always safe. Restart the same board size or choose another one.";

    if (typeof elements.resultDialog.showModal === "function" && !elements.resultDialog.open) {
      elements.resultDialog.showModal();
    } else {
      elements.resultDialog.setAttribute("open", "");
    }
  }

  function closeResultDialog() {
    if (elements.resultDialog.open && typeof elements.resultDialog.close === "function") {
      elements.resultDialog.close();
    } else {
      elements.resultDialog.removeAttribute("open");
    }
  }

  function syncCellSize() {
    if (!game || elements.gameScreen.hidden) return;

    const viewportStyles = window.getComputedStyle(elements.boardViewport);
    const boardStyles = window.getComputedStyle(elements.board);
    const horizontalPadding =
      Number.parseFloat(viewportStyles.paddingLeft) + Number.parseFloat(viewportStyles.paddingRight);
    const gap = Number.parseFloat(boardStyles.columnGap) || 0;
    const availableWidth = Math.max(240, elements.boardViewport.clientWidth - horizontalPadding);
    const fittedSize = Math.floor((availableWidth - gap * (game.columns - 1)) / game.columns);
    const cellSize = clamp(fittedSize, largeCells ? 44 : 28, 52);

    elements.board.style.setProperty("--cell-size", `${cellSize}px`);
    // Ignore subpixel rounding when the board fits against the viewport edge.
    const overflows = cellSize * game.columns + gap * (game.columns - 1) > availableWidth + 1;
    elements.scrollHint.hidden = !overflows;
    if (overflows) {
      elements.board.setAttribute("aria-describedby", "board-scroll-hint");
    } else {
      elements.board.removeAttribute("aria-describedby");
    }
  }

  function showFormError(message) {
    elements.customError.textContent = message;
    elements.customError.hidden = false;
  }

  function hideFormError() {
    elements.customError.textContent = "";
    elements.customError.hidden = true;
  }

  function announce(message) {
    elements.announcement.textContent = "";
    window.setTimeout(() => {
      elements.announcement.textContent = message;
    }, 20);
  }

  function parseWholeNumber(value) {
    const number = Number(value);
    return Number.isInteger(number) ? number : null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
})();
