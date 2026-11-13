"use strict";
(() => {
  // ../tmp/nova-games/c4/core/src/utils.ts
  var BIG_POSITIVE_NUMBER = 10 ** 9 + 7;
  var BIG_NEGATIVE_NUMBER = -BIG_POSITIVE_NUMBER;
  function isCoordOnColumn(coord, columnXBegin, radius) {
    return (coord.x - columnXBegin) * (coord.x - columnXBegin) <= radius * radius;
  }
  function getColumnFromCoord(coord) {
    for (let i = 0; i < BoardBase.COLUMNS; i++)
      if (isCoordOnColumn(
        coord,
        3 * BoardBase.PIECE_RADIUS * i + BoardBase.MASK_X_BEGIN + 2 * BoardBase.PIECE_RADIUS,
        BoardBase.PIECE_RADIUS
      ))
        return i;
    return -1;
  }
  function choose(choice) {
    return choice[Math.floor(Math.random() * choice.length)];
  }
  function clone(array) {
    const arr = [];
    for (let i = 0; i < array.length; i++) arr[i] = array[i].slice();
    return arr;
  }
  function getMockPlayerAction(map, boardPiece, column) {
    const clonedMap = clone(map);
    if (clonedMap[0][column] !== " " /* EMPTY */ || column < 0 || column >= BoardBase.COLUMNS)
      return {
        success: false,
        map: clonedMap
      };
    let isColumnEverFilled = false;
    let row = 0;
    for (let i = 0; i < BoardBase.ROWS - 1; i++)
      if (clonedMap[i + 1][column] !== " " /* EMPTY */) {
        isColumnEverFilled = true;
        row = i;
        break;
      }
    if (!isColumnEverFilled) row = BoardBase.ROWS - 1;
    clonedMap[row][column] = boardPiece;
    return {
      success: true,
      map: clonedMap
    };
  }

  // ../tmp/nova-games/c4/core/src/board/base.ts
  var BoardBase = class _BoardBase {
    static ROWS = 6;
    static COLUMNS = 7;
    static PLAYER_1_COLOR = "#ef453b";
    static PLAYER_2_COLOR = "#0059ff";
    static PIECE_STROKE_STYLE = "black";
    static MASK_COLOR = "#d8d8d8";
    static CANVAS_HEIGHT;
    static CANVAS_WIDTH;
    static PIECE_RADIUS;
    static MASK_X_BEGIN;
    static MASK_Y_BEGIN;
    static MESSAGE_WIDTH;
    static MESSAGE_X_BEGIN;
    static MESSAGE_Y_BEGIN;
    static SCALE;
    map;
    winnerBoardPiece;
    constructor() {
      this.map = [];
      this.winnerBoardPiece = " " /* EMPTY */;
      this.initConstants();
      this.reset();
    }
    reset() {
      this.map = [];
      for (let i = 0; i < _BoardBase.ROWS; i++) {
        this.map.push([]);
        for (let j = 0; j < _BoardBase.COLUMNS; j++) {
          this.map[i].push(" " /* EMPTY */);
        }
      }
      this.winnerBoardPiece = " " /* EMPTY */;
    }
    initConstants() {
      _BoardBase.CANVAS_HEIGHT = _BoardBase.SCALE * 480;
      _BoardBase.CANVAS_WIDTH = _BoardBase.SCALE * 640;
      _BoardBase.PIECE_RADIUS = _BoardBase.SCALE * 25;
      _BoardBase.MASK_X_BEGIN = Math.max(
        0,
        _BoardBase.CANVAS_WIDTH - (3 * _BoardBase.COLUMNS + 1) * _BoardBase.PIECE_RADIUS
      ) / 2;
      _BoardBase.MASK_Y_BEGIN = Math.max(
        0,
        _BoardBase.CANVAS_HEIGHT - (3 * _BoardBase.ROWS + 1) * _BoardBase.PIECE_RADIUS
      ) / 2;
      _BoardBase.MESSAGE_WIDTH = _BoardBase.SCALE * 400;
      _BoardBase.MESSAGE_X_BEGIN = (_BoardBase.CANVAS_WIDTH - _BoardBase.MESSAGE_WIDTH) / 2;
      _BoardBase.MESSAGE_Y_BEGIN = _BoardBase.SCALE * 20;
    }
    /**
     * @returns is the action succesfully applied
     * @param player current player
     * @param column the colum in which the player want to drop a piece
     */
    async applyPlayerAction(player, column) {
      const { success: actionSuccessful, map: nextState } = getMockPlayerAction(
        this.map,
        player.boardPiece,
        column
      );
      this.map = nextState;
      return actionSuccessful;
    }
    debug() {
      console.log(this.map.map((row) => row.join(" ")).join("\n"));
    }
    getWinner() {
      if (this.winnerBoardPiece !== " " /* EMPTY */) {
        return this.winnerBoardPiece;
      }
      const direction = [
        [0, -1],
        [0, 1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [1, -1],
        [1, 0],
        [1, 1]
      ];
      const isWinningSequence = (i, j, playerPiece, dir, count) => {
        if (count >= 4) {
          return true;
        }
        if (i < 0 || j < 0 || i >= _BoardBase.ROWS || j >= _BoardBase.COLUMNS || this.map[i][j] !== playerPiece) {
          return false;
        }
        return isWinningSequence(
          i + dir[0],
          j + dir[1],
          playerPiece,
          dir,
          count + 1
        );
      };
      let countEmpty = 0;
      for (let i = 0; i < _BoardBase.ROWS; i++) {
        for (let j = 0; j < _BoardBase.COLUMNS; j++) {
          const playerPiece = this.map[i][j];
          if (playerPiece !== " " /* EMPTY */) {
            for (let k = 0; k < direction.length; k++) {
              const isWon = isWinningSequence(
                i + direction[k][0],
                j + direction[k][1],
                playerPiece,
                direction[k],
                1
              );
              if (isWon) {
                this.winnerBoardPiece = playerPiece;
                return playerPiece;
              }
            }
          } else {
            countEmpty++;
          }
        }
      }
      if (countEmpty === 0) {
        this.winnerBoardPiece = "D" /* DRAW */;
        return "D" /* DRAW */;
      }
      return " " /* EMPTY */;
    }
    getPlayerColor(boardPiece) {
      switch (boardPiece) {
        case "\u{1F534}" /* PLAYER_1 */:
          return _BoardBase.PLAYER_1_COLOR;
        case "\u{1F535}" /* PLAYER_2 */:
          return _BoardBase.PLAYER_2_COLOR;
        default:
          return "transparent";
      }
    }
  };

  // ../tmp/nova-games/c4/core/src/game/game-base.ts
  var GameBase = class {
    board;
    players;
    currentPlayerId;
    isMoveAllowed = false;
    isGameWon = false;
    isGameEnded = false;
    sessionId = 0;
    constructor(players, board) {
      this.board = board;
      this.players = players;
      this.currentPlayerId = 0;
      this.reset();
    }
    reset() {
      this.sessionId++;
      this.isMoveAllowed = false;
      this.isGameWon = false;
      this.isGameEnded = false;
      this.cancelPendingActions();
      this.board.reset();
    }
    end() {
      this.stopCurrentSession();
      this.isGameEnded = true;
      this.board.reset();
    }
    async start() {
      if (this.isGameEnded) {
        return;
      }
      this.stopCurrentSession();
      const sessionId = this.sessionId;
      this.isMoveAllowed = true;
      try {
        while (!this.isGameWon && this.isCurrentSession(sessionId)) {
          if (this.isGameEnded) {
            return;
          }
          await this.move(sessionId);
          if (!this.isCurrentSession(sessionId)) {
            return;
          }
          const winner = this.board.getWinner();
          if (winner !== " " /* EMPTY */) {
            console.log("[GameBase] Game over: winner is player ", winner);
            this.isGameWon = true;
            this.isMoveAllowed = false;
            this.announceWinner(winner);
            break;
          }
        }
      } catch (error) {
        if (this.isCurrentSession(sessionId)) {
          this.isMoveAllowed = false;
          console.error(
            "[GameBase] Game stopped after an unexpected error",
            error
          );
        }
      }
    }
    async move(sessionId = this.sessionId) {
      if (!this.isCurrentSession(sessionId) || this.isGameEnded) {
        return;
      }
      if (!this.isMoveAllowed) {
        return;
      }
      const currentPlayer = this.players[this.currentPlayerId];
      let actionSuccesful = false;
      while (!actionSuccesful && this.isCurrentSession(sessionId)) {
        if (this.isGameEnded) {
          return;
        }
        this.waitingForMove();
        const action = await currentPlayer.getAction(this.board);
        if (!this.isCurrentSession(sessionId)) {
          return;
        }
        this.isMoveAllowed = false;
        this.beforeMoveApplied(action);
        actionSuccesful = await this.board.applyPlayerAction(
          currentPlayer,
          action
        );
        if (!this.isCurrentSession(sessionId)) {
          return;
        }
        this.isMoveAllowed = true;
        if (!actionSuccesful) {
          console.log("Move not allowed! Try again.");
        } else {
          this.afterMove(action);
        }
      }
      this.currentPlayerId = this.getNextPlayer();
    }
    announceWinner(winnerPiece) {
      const winner = {
        ["D" /* DRAW */]: "draw",
        ["\u{1F534}" /* PLAYER_1 */]: "Player 1",
        ["\u{1F535}" /* PLAYER_2 */]: "Player 2",
        [" " /* EMPTY */]: "none"
      }[winnerPiece];
      console.log("[GameBase] Game over: winner is ", winner, winnerPiece);
    }
    stopCurrentSession() {
      this.sessionId++;
      this.isMoveAllowed = false;
      this.cancelPendingActions();
    }
    getNextPlayer() {
      return this.currentPlayerId === 0 ? 1 : 0;
    }
    isCurrentSession(sessionId) {
      return sessionId === this.sessionId;
    }
    cancelPendingActions() {
      for (const player of this.players) {
        player.cancelPendingAction();
      }
    }
  };

  // ../tmp/nova-games/c4/core/src/game/game-online/shared.ts
  function constructMessage(type, payload) {
    console.log("[ws] send: ", type, payload);
    return JSON.stringify({
      type,
      payload: payload || {}
    });
  }
  function parseMessage(message) {
    const parsedMessage = JSON.parse(message);
    console.log("[ws] receive: ", parsedMessage);
    return parsedMessage;
  }

  // ../tmp/nova-games/c4/core/src/player/player.ts
  var Player = class {
    boardPiece;
    /** player name, etc */
    label;
    cancelPendingAction() {
    }
    constructor(boardPiece, label) {
      this.boardPiece = boardPiece;
      this.label = label;
    }
  };

  // ../tmp/nova-games/c4/core/src/player/player-ai.ts
  var PlayerAi = class _PlayerAi extends Player {
    static MAX_DEPTH = 4;
    ownBoardPieceValue;
    enemyBoardPiece;
    constructor(boardPiece, label) {
      super(boardPiece, label);
      this.ownBoardPieceValue = this.getBoardPieceValue(boardPiece);
      this.enemyBoardPiece = boardPiece === "\u{1F534}" /* PLAYER_1 */ ? "\u{1F535}" /* PLAYER_2 */ : "\u{1F534}" /* PLAYER_1 */;
    }
    getBoardPieceValue(boardPiece) {
      return boardPiece === " " /* EMPTY */ ? 0 : boardPiece === this.boardPiece ? 1 : -1;
    }
    getStateValue(state) {
      let winnerBoardPiece = " " /* EMPTY */;
      let chainValue = 0;
      for (let i = 0; i < BoardBase.ROWS; i++) {
        for (let j = 0; j < BoardBase.COLUMNS; j++) {
          let tempRight = 0, tempBottom = 0, tempBottomRight = 0, tempTopRight = 0;
          for (let k = 0; k <= 3; k++) {
            if (j + k < BoardBase.COLUMNS) {
              tempRight += this.getBoardPieceValue(state[i][j + k]);
            }
            if (i + k < BoardBase.ROWS) {
              tempBottom += this.getBoardPieceValue(state[i + k][j]);
            }
            if (i + k < BoardBase.ROWS && j + k < BoardBase.COLUMNS) {
              tempBottomRight += this.getBoardPieceValue(state[i + k][j + k]);
            }
            if (i - k >= 0 && j + k < 7) {
              tempTopRight += this.getBoardPieceValue(state[i - k][j + k]);
            }
          }
          chainValue += tempRight * tempRight * tempRight;
          chainValue += tempBottom * tempBottom * tempBottom;
          chainValue += tempBottomRight * tempBottomRight * tempBottomRight;
          chainValue += tempTopRight * tempTopRight * tempTopRight;
          if (Math.abs(tempRight) === 4) {
            winnerBoardPiece = tempRight > 0 ? this.boardPiece : this.enemyBoardPiece;
          } else if (Math.abs(tempBottom) === 4) {
            winnerBoardPiece = tempBottom > 0 ? this.boardPiece : this.enemyBoardPiece;
          } else if (Math.abs(tempBottomRight) === 4) {
            winnerBoardPiece = tempBottomRight > 0 ? this.boardPiece : this.enemyBoardPiece;
          } else if (Math.abs(tempTopRight) === 4) {
            winnerBoardPiece = tempTopRight > 0 ? this.boardPiece : this.enemyBoardPiece;
          }
        }
      }
      return {
        winnerBoardPiece,
        chain: chainValue
      };
    }
    /**
     * @return transformed value, so the AI could take a "lower hanging fruit",
     *          i.e. a reward in closer future worth more than the same reward in distant future
     * @param returnValue
     * @param winnerBoardPiece
     * @param depth
     */
    transformValues(returnValue, winnerBoardPiece, depth) {
      const isWon = winnerBoardPiece === this.boardPiece;
      const isLost = winnerBoardPiece === this.enemyBoardPiece;
      returnValue -= depth * depth;
      if (isWon) {
        returnValue = BIG_POSITIVE_NUMBER - 100 - depth * depth;
      } else if (isLost) {
        returnValue = BIG_NEGATIVE_NUMBER + 100 + depth * depth;
      }
      return returnValue;
    }
    getMove(state, depth, alpha, beta) {
      const stateValue = this.getStateValue(state);
      const isWon = stateValue.winnerBoardPiece === this.boardPiece;
      const isLost = stateValue.winnerBoardPiece === this.enemyBoardPiece;
      if (depth >= _PlayerAi.MAX_DEPTH || isWon || isLost) {
        return {
          value: this.transformValues(
            stateValue.chain,
            stateValue.winnerBoardPiece,
            depth
          ) * this.ownBoardPieceValue,
          move: -1
          // leaf node
        };
      }
      return depth % 2 === 0 ? this.minState(state, depth + 1, alpha, beta) : this.maxState(state, depth + 1, alpha, beta);
    }
    maxState(state, depth, alpha, beta) {
      let value = BIG_NEGATIVE_NUMBER;
      let moveQueue = [];
      for (let column = 0; column < BoardBase.COLUMNS; column++) {
        const { success: actionSuccessful, map: nextState } = getMockPlayerAction(
          state,
          this.boardPiece,
          column
        );
        if (!actionSuccessful) {
          continue;
        }
        const { value: nextValue } = this.getMove(nextState, depth, alpha, beta);
        if (nextValue > value) {
          value = nextValue;
          moveQueue = [column];
        } else if (nextValue === value) {
          moveQueue.push(column);
        }
        if (value > beta) {
          return {
            value,
            move: choose(moveQueue)
          };
        }
        alpha = Math.max(alpha, value);
      }
      return {
        value,
        move: choose(moveQueue)
      };
    }
    minState(state, depth, alpha, beta) {
      let value = BIG_POSITIVE_NUMBER;
      let moveQueue = [];
      for (let column = 0; column < BoardBase.COLUMNS; column++) {
        const { success: actionSuccessful, map: nextState } = getMockPlayerAction(
          state,
          this.enemyBoardPiece,
          column
        );
        if (!actionSuccessful) {
          continue;
        }
        const { value: nextValue } = this.getMove(nextState, depth, alpha, beta);
        if (nextValue < value) {
          value = nextValue;
          moveQueue = [column];
        } else if (nextValue === value) {
          moveQueue.push(column);
        }
        if (value < alpha) {
          return {
            value,
            move: choose(moveQueue)
          };
        }
        beta = Math.min(beta, value);
      }
      return {
        value,
        move: choose(moveQueue)
      };
    }
    async getAction(board) {
      const state = clone(board.map);
      const action = this.maxState(
        state,
        0,
        BIG_NEGATIVE_NUMBER,
        BIG_POSITIVE_NUMBER
      );
      console.log(
        `AI ${this.boardPiece} choose column ${action.move} with value of ${action.value}`
      );
      return action.move;
    }
  };

  // ../tmp/nova-games/c4/core/src/player/player-human.ts
  var PlayerHuman = class extends Player {
    clickPromiseResolver;
    constructor(boardPiece, label) {
      super(boardPiece, label);
      this.clickPromiseResolver = null;
    }
    doAction(column) {
      if (this.clickPromiseResolver && 0 <= column && column < BoardBase.COLUMNS) {
        this.resolveAction(column);
      }
    }
    getAction(_board) {
      this.cancelPendingAction();
      return new Promise((resolve) => {
        this.clickPromiseResolver = resolve;
      });
    }
    cancelPendingAction() {
      this.resolveAction(-1);
    }
    resolveAction(column) {
      const resolve = this.clickPromiseResolver;
      this.clickPromiseResolver = null;
      resolve?.(column);
    }
  };

  // ../tmp/nova-games/c4/core/src/player/player-shadow.ts
  var PlayerShadow = class extends Player {
    actionPromiseResolver;
    constructor(boardPiece, label) {
      super(boardPiece, label);
      this.actionPromiseResolver = null;
    }
    doAction(column) {
      if (this.actionPromiseResolver && 0 <= column && column < BoardBase.COLUMNS) {
        this.resolveAction(column);
      }
    }
    getAction(_board) {
      this.cancelPendingAction();
      return new Promise((resolve) => {
        this.actionPromiseResolver = resolve;
      });
    }
    cancelPendingAction() {
      this.resolveAction(-1);
    }
    resolveAction(column) {
      const resolve = this.actionPromiseResolver;
      this.actionPromiseResolver = null;
      resolve?.(column);
    }
  };

  // ../tmp/nova-games/c4/browser/src/utils/animate-frame.ts
  function animationFrame() {
    let resolve = null;
    const promise = new Promise((r) => resolve = r);
    if (resolve) window.requestAnimationFrame(resolve);
    return promise;
  }

  // ../tmp/nova-games/c4/browser/src/board/utils.ts
  function onresize(callback) {
    let running = false;
    let disposed = false;
    let animationFrameId;
    let timeoutId;
    function resize() {
      if (!disposed && !running) {
        running = true;
        if (window.requestAnimationFrame) {
          animationFrameId = window.requestAnimationFrame(runCallbacks);
        } else {
          timeoutId = setTimeout(runCallbacks, 66);
        }
      }
    }
    function runCallbacks() {
      animationFrameId = void 0;
      timeoutId = void 0;
      if (!disposed) {
        callback();
      }
      running = false;
    }
    window.addEventListener("resize", resize);
    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      window.removeEventListener("resize", resize);
      if (animationFrameId !== void 0) {
        window.cancelAnimationFrame(animationFrameId);
      }
      if (timeoutId !== void 0) {
        clearTimeout(timeoutId);
      }
      running = false;
    };
  }
  function drawCircle(context, { x = 0, y = 0, r = 0, fillStyle = "", strokeStyle = "" }) {
    context.save();
    context.fillStyle = fillStyle;
    context.strokeStyle = strokeStyle;
    context.beginPath();
    context.arc(x, y, r, 0, 2 * Math.PI, false);
    context.fill();
    context.restore();
  }
  function drawMask(board) {
    const context = board.context;
    context.save();
    context.fillStyle = Board.MASK_COLOR;
    context.beginPath();
    const doubleRadius = 2 * Board.PIECE_RADIUS;
    const tripleRadius = 3 * Board.PIECE_RADIUS;
    for (let y = 0; y < Board.ROWS; y++) {
      for (let x = 0; x < Board.COLUMNS; x++) {
        context.arc(
          tripleRadius * x + Board.MASK_X_BEGIN + doubleRadius,
          tripleRadius * y + Board.MASK_Y_BEGIN + doubleRadius,
          Board.PIECE_RADIUS,
          0,
          2 * Math.PI
        );
        context.rect(
          tripleRadius * x + Board.MASK_X_BEGIN + 2 * doubleRadius,
          tripleRadius * y + Board.MASK_Y_BEGIN,
          -2 * doubleRadius,
          2 * doubleRadius
        );
      }
    }
    context.fill();
    context.restore();
  }
  function clearCanvas(board) {
    board.context.clearRect(0, 0, Board.CANVAS_WIDTH, Board.CANVAS_HEIGHT);
  }

  // ../tmp/nova-games/c4/browser/src/board/index.ts
  var Board = class _Board extends BoardBase {
    canvas;
    context;
    animationId = 0;
    removeResizeListener;
    constructor(canvas) {
      super();
      this.canvas = canvas;
      this.context = canvas.getContext("2d");
      this.getBoardScale();
      this.initConstants();
      this.reset();
      this.onresize();
    }
    getBoardScale() {
      if (window.innerWidth < 640) {
        BoardBase.SCALE = 0.5;
      } else {
        BoardBase.SCALE = 1;
      }
      return BoardBase.SCALE;
    }
    onresize() {
      let prevBoardScale = BoardBase.SCALE;
      this.removeResizeListener = onresize(() => {
        this.getBoardScale();
        if (prevBoardScale !== BoardBase.SCALE) {
          prevBoardScale = BoardBase.SCALE;
          this.initConstants();
          clearCanvas(this);
          this.render();
        }
      });
    }
    reset() {
      this.animationId = (this.animationId || 0) + 1;
      super.reset();
      if (this.canvas) {
        clearCanvas(this);
        this.render();
      }
    }
    initConstants() {
      super.initConstants();
      if (this.canvas) {
        const dpr = self.devicePixelRatio || 1;
        this.canvas.width = _Board.CANVAS_WIDTH * dpr;
        this.canvas.height = _Board.CANVAS_HEIGHT * dpr;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.canvas.style.width = `${_Board.CANVAS_WIDTH}px`;
        this.canvas.style.height = `${_Board.CANVAS_HEIGHT}px`;
      }
    }
    dispose() {
      this.animationId++;
      this.removeResizeListener?.();
      this.removeResizeListener = void 0;
    }
    async animateAction(newRow, column, boardPiece, animationId) {
      const fillStyle = this.getPlayerColor(boardPiece);
      let currentY = 0;
      const doAnimation = () => {
        if (animationId !== this.animationId) {
          return false;
        }
        clearCanvas(this);
        drawCircle(this.context, {
          x: 3 * BoardBase.PIECE_RADIUS * column + BoardBase.MASK_X_BEGIN + 2 * BoardBase.PIECE_RADIUS,
          y: currentY + BoardBase.MASK_Y_BEGIN + 2 * BoardBase.PIECE_RADIUS,
          r: BoardBase.PIECE_RADIUS,
          fillStyle,
          strokeStyle: BoardBase.PIECE_STROKE_STYLE
        });
        this.render();
        currentY += BoardBase.PIECE_RADIUS;
        return true;
      };
      while (animationId === this.animationId && newRow * 3 * BoardBase.PIECE_RADIUS >= currentY) {
        await animationFrame();
        if (!doAnimation()) {
          return false;
        }
      }
      return animationId === this.animationId;
    }
    render() {
      drawMask(this);
      for (let y = 0; y < BoardBase.ROWS; y++) {
        for (let x = 0; x < BoardBase.COLUMNS; x++) {
          drawCircle(this.context, {
            x: 3 * BoardBase.PIECE_RADIUS * x + BoardBase.MASK_X_BEGIN + 2 * BoardBase.PIECE_RADIUS,
            y: 3 * BoardBase.PIECE_RADIUS * y + BoardBase.MASK_Y_BEGIN + 2 * BoardBase.PIECE_RADIUS,
            r: BoardBase.PIECE_RADIUS,
            fillStyle: this.getPlayerColor(this.map[y][x]),
            strokeStyle: BoardBase.PIECE_STROKE_STYLE
          });
        }
      }
    }
    async applyPlayerAction(player, column) {
      if (column < 0 || column >= BoardBase.COLUMNS || this.map[0][column] !== " " /* EMPTY */) {
        return false;
      }
      let isColumnEverFilled = false;
      let row = 0;
      for (let i = 0; i < BoardBase.ROWS - 1; i++) {
        if (this.map[i + 1][column] !== " " /* EMPTY */) {
          isColumnEverFilled = true;
          row = i;
          break;
        }
      }
      if (!isColumnEverFilled) {
        row = BoardBase.ROWS - 1;
      }
      const animationId = this.animationId;
      if (!await this.animateAction(row, column, player.boardPiece, animationId)) {
        return false;
      }
      if (animationId !== this.animationId) {
        return false;
      }
      this.map[row][column] = player.boardPiece;
      this.debug();
      await animationFrame();
      if (animationId !== this.animationId) {
        return false;
      }
      this.render();
      return true;
    }
  };

  // ../tmp/nova-games/c4/browser/src/utils/message.ts
  function showMessage({
    title,
    messages = [],
    render
  }) {
    const messageDOM = document.querySelector(".message-body");
    if (!messageDOM) {
      console.error(".message-body not found");
      return void 0;
    }
    const messageContentDOM = document.querySelector(
      ".message-body-content"
    );
    if (!messageContentDOM) {
      console.error(".message-body-content not found");
      return void 0;
    }
    if (messageDOM.hasAttribute("open")) {
      messageDOM.close();
    }
    const heading = document.createElement("h2");
    heading.id = "message-title";
    heading.textContent = title;
    messageContentDOM.replaceChildren(heading);
    for (const message of messages) {
      const paragraph = document.createElement("p");
      paragraph.textContent = message;
      messageContentDOM.append(paragraph);
    }
    render?.(messageContentDOM);
    messageDOM.showModal();
    return messageDOM;
  }

  // ../tmp/nova-games/c4/browser/src/game/game-accessibility.ts
  var liveRegion = document.querySelector(".section-message");
  var boardStateBody = document.querySelector(".board-state-body");
  var boardPlayerLegend = document.querySelector(".board-player-legend");
  var lastRenderedBoardState;
  var boardPieceLabel = {
    [" " /* EMPTY */]: "Empty",
    ["\u{1F534}" /* PLAYER_1 */]: "Player 1",
    ["\u{1F535}" /* PLAYER_2 */]: "Player 2",
    ["D" /* DRAW */]: "Draw"
  };
  function announce(message) {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  }
  function renderBoardState(board, players) {
    if (!boardStateBody) {
      return;
    }
    const boardState = JSON.stringify({
      map: board.map,
      players: players.map(({ boardPiece, label }) => ({ boardPiece, label }))
    });
    if (boardState === lastRenderedBoardState) {
      return;
    }
    lastRenderedBoardState = boardState;
    const labels = new Map(
      players.map((player) => [player.boardPiece, player.label])
    );
    if (boardPlayerLegend) {
      boardPlayerLegend.textContent = players.map(
        (player) => `${boardPieceLabel[player.boardPiece]} is ${player.label}.`
      ).join(" ");
    }
    const rows = board.map.map((row, rowIndex) => {
      const tableRow = document.createElement("tr");
      const rowHeader = document.createElement("th");
      rowHeader.scope = "row";
      rowHeader.textContent = `Row ${rowIndex + 1}`;
      tableRow.append(rowHeader);
      for (const boardPiece of row) {
        const cell = document.createElement("td");
        const label = labels.get(boardPiece);
        cell.textContent = label ? `${boardPieceLabel[boardPiece]}: ${label}` : boardPieceLabel[boardPiece];
        tableRow.append(cell);
      }
      return tableRow;
    });
    boardStateBody.replaceChildren(...rows);
  }
  function getMoveRow(board, column) {
    for (let row = 0; row < BoardBase.ROWS; row++) {
      if (board.map[row][column] !== " " /* EMPTY */) {
        return row + 1;
      }
    }
    return void 0;
  }

  // ../tmp/nova-games/c4/browser/src/game/game-controls.ts
  function isTextInput(target) {
    return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
  }
  function activateGameControls(onColumnSelected, isColumnAvailable) {
    const gameControls = document.querySelector(".game-controls");
    const controls = Array.from(
      document.querySelectorAll(".game-control")
    );
    const dialogs = Array.from(document.querySelectorAll("dialog"));
    let isYourTurn = false;
    let focusPending = false;
    let disposed = false;
    function focusStart() {
      if (!focusPending || !isYourTurn || document.querySelector("dialog[open]")) {
        return;
      }
      gameControls?.focus({ preventScroll: true });
      focusPending = false;
    }
    function setTurn(enabled) {
      if (disposed) {
        return;
      }
      const turnStarted = enabled && !isYourTurn;
      isYourTurn = enabled;
      for (const [column, control] of controls.entries()) {
        control.disabled = !enabled || !isColumnAvailable(column);
      }
      if (!enabled) {
        focusPending = false;
      } else if (turnStarted) {
        focusPending = true;
        focusStart();
      }
    }
    function playColumn(column) {
      if (disposed || !isYourTurn || !controls[column] || document.querySelector("dialog[open]")) {
        return;
      }
      if (controls[column].disabled) {
        announce(`Column ${column + 1} is full. Choose another column.`);
        return;
      }
      setTurn(false);
      onColumnSelected(column);
    }
    const handleControlClick = (event) => {
      const button = event.currentTarget;
      playColumn(Number(button.dataset.column));
    };
    const handleKeydown = (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || !isYourTurn || document.querySelector("dialog[open]") || isTextInput(event.target) || !/^[1-7]$/.test(event.key)) {
        return;
      }
      event.preventDefault();
      playColumn(Number(event.key) - 1);
    };
    gameControls?.classList.remove("hidden");
    setTurn(false);
    for (const control of controls) {
      control.addEventListener("click", handleControlClick);
    }
    document.addEventListener("keydown", handleKeydown);
    for (const dialog of dialogs) {
      dialog.addEventListener("close", focusStart);
    }
    return {
      setTurn,
      playColumn,
      dispose() {
        setTurn(false);
        disposed = true;
        gameControls?.classList.add("hidden");
        for (const control of controls) {
          control.removeEventListener("click", handleControlClick);
        }
        document.removeEventListener("keydown", handleKeydown);
        for (const dialog of dialogs) {
          dialog.removeEventListener("close", focusStart);
        }
      }
    };
  }

  // ../tmp/nova-games/c4/browser/src/game/game-local.ts
  var statusbox = document.querySelector(".statusbox");
  var statusboxBodyGame = document.querySelector(".statusbox-body-game");
  var statusboxBodyConnection = document.querySelector(
    ".statusbox-body-connection"
  );
  var statusboxBodyPlayer = document.querySelector(".statusbox-body-player");
  var playAgainButton = document.querySelector(
    ".statusbox-button-play-again"
  );
  var GameLocal = class extends GameBase {
    controls;
    pendingMoveAnnouncement;
    constructor(players, board) {
      super(players, board);
    }
    reset() {
      this.pendingMoveAnnouncement = void 0;
      super.reset();
    }
    beforeMoveApplied() {
      this.controls?.setTurn(false);
      if (statusboxBodyGame) {
        const currentPlayer = this.players[this.currentPlayerId];
        statusboxBodyGame.textContent = `Dropping ${currentPlayer.boardPiece} disc`;
      }
    }
    waitingForMove() {
      renderBoardState(this.board, this.players);
      this.controls?.setTurn(
        this.isMoveAllowed && !this.isGameWon && !this.isGameEnded && this.players[this.currentPlayerId] instanceof PlayerHuman
      );
      if (!this.isMoveAllowed || this.isGameWon) {
        return;
      }
      if (statusboxBodyGame) {
        statusboxBodyGame.textContent = "Wating for move";
      }
      const currentPlayer = this.players[this.currentPlayerId];
      if (statusboxBodyPlayer) {
        statusboxBodyPlayer.textContent = `${currentPlayer.label} ${currentPlayer.boardPiece}`;
      }
      const turnAnnouncement = `${currentPlayer.label}'s turn.`;
      announce(
        this.pendingMoveAnnouncement ? `${this.pendingMoveAnnouncement} It is now ${turnAnnouncement}` : turnAnnouncement
      );
      this.pendingMoveAnnouncement = void 0;
    }
    afterMove(action) {
      renderBoardState(this.board, this.players);
      const currentPlayer = this.players[this.currentPlayerId];
      const row = getMoveRow(this.board, action);
      this.pendingMoveAnnouncement = `${currentPlayer.label} placed a disc in column ${action + 1}${row ? `, row ${row}` : ""}.`;
    }
    announceWinner(winnerBoardPiece) {
      this.controls?.setTurn(false);
      this.pendingMoveAnnouncement = void 0;
      super.announceWinner(winnerBoardPiece);
      if (winnerBoardPiece === " " /* EMPTY */) {
        return;
      }
      let winnerPlayer;
      let result = "";
      if (winnerBoardPiece === "D" /* DRAW */) {
        result = `It's a draw.`;
      } else {
        winnerPlayer = this.players.find(
          (player) => player.boardPiece === winnerBoardPiece
        );
        if (winnerPlayer) {
          result = `${winnerPlayer.label} won.`;
        } else {
          result = `Player ${winnerBoardPiece} won.`;
        }
      }
      renderBoardState(this.board, this.players);
      const messageDialog = showMessage({
        title: "Thank you for playing.",
        messages: [result, "Use the Play again button to start a new game."]
      });
      messageDialog?.addEventListener("close", () => playAgainButton?.focus(), {
        once: true
      });
      playAgainButton?.classList.remove("hidden");
      if (statusboxBodyGame) {
        statusboxBodyGame.textContent = "Game over";
      }
      if (statusboxBodyPlayer) {
        statusboxBodyPlayer.textContent = winnerBoardPiece === "D" /* DRAW */ ? `It's a draw` : winnerPlayer ? `${winnerPlayer.label} ${winnerPlayer.boardPiece} won` : `Player ${winnerBoardPiece === "\u{1F534}" /* PLAYER_1 */ ? "1 \u{1F534}" : "2 \u{1F535}"} won`;
      }
      announce(result);
    }
  };
  function initGameLocal(GameLocalConstructor, firstPlayer, secondPlayer) {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      console.error("Canvas DOM is null");
      return;
    }
    const board = new Board(canvas);
    const game = new GameLocalConstructor([firstPlayer, secondPlayer], board);
    let disposed = false;
    statusbox?.classList.remove("hidden");
    statusboxBodyConnection?.classList.add("hidden");
    playAgainButton?.classList.add("hidden");
    if (statusboxBodyGame) {
      statusboxBodyGame.textContent = "Wating for move";
    }
    if (statusboxBodyPlayer) {
      statusboxBodyPlayer.textContent = `${firstPlayer.label} ${firstPlayer.boardPiece}`;
    }
    renderBoardState(board, [firstPlayer, secondPlayer]);
    function playColumn(column) {
      if (disposed || game.isGameWon || game.isGameEnded || !game.isMoveAllowed) {
        return;
      }
      if (game.currentPlayerId === 0) {
        firstPlayer.doAction(column);
      } else if (game.currentPlayerId === 1 && secondPlayer instanceof PlayerHuman) {
        secondPlayer.doAction(column);
      }
    }
    async function restartGame() {
      if (disposed || !game.isGameWon) {
        return;
      }
      playAgainButton?.classList.add("hidden");
      game.reset();
      await animationFrame();
      if (disposed) {
        return;
      }
      game.start();
    }
    function handleCanvasClick(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      controls.playColumn(getColumnFromCoord({ x, y }));
    }
    const controls = activateGameControls(
      playColumn,
      (column) => board.map[0][column] === " " /* EMPTY */
    );
    game.controls = controls;
    game.start();
    canvas.addEventListener("click", handleCanvasClick);
    return {
      end: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        game.end();
        controls.dispose();
        canvas.removeEventListener("click", handleCanvasClick);
        board.dispose();
        playAgainButton?.classList.add("hidden");
        statusbox?.classList.add("hidden");
      },
      restart: restartGame
    };
  }

  // ../tmp/nova-games/c4/browser/src/game/game-ai-vs-ai.ts
  var statusbox2 = document.querySelector(".statusbox");
  var statusboxBodyGame2 = document.querySelector(".statusbox-body-game");
  var statusboxBodyConnection2 = document.querySelector(
    ".statusbox-body-connection"
  );
  var statusboxBodyPlayer2 = document.querySelector(".statusbox-body-player");
  var playAgainButton2 = document.querySelector(
    ".statusbox-button-play-again"
  );
  var GameAiVsAi = class extends GameLocal {
    constructor(players, board) {
      super(players, board);
    }
    announceWinner(winnerBoardPiece) {
      super.announceWinner(winnerBoardPiece);
    }
  };
  function initGameAiVsAi() {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      console.error("Canvas DOM is null");
      return;
    }
    const board = new Board(canvas);
    const firstPlayer = new PlayerAi("\u{1F534}" /* PLAYER_1 */, `AI Player 1`);
    const secondPlayer = new PlayerAi("\u{1F535}" /* PLAYER_2 */, `AI Player 2`);
    const game = new GameAiVsAi([firstPlayer, secondPlayer], board);
    let disposed = false;
    statusbox2?.classList.remove("hidden");
    statusboxBodyConnection2?.classList.add("hidden");
    playAgainButton2?.classList.add("hidden");
    game.start();
    async function restartGame() {
      if (disposed || !game.isGameWon) {
        return;
      }
      playAgainButton2?.classList.add("hidden");
      game.reset();
      await animationFrame();
      if (disposed) {
        return;
      }
      game.start();
    }
    return {
      end: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        game.end();
        board.dispose();
        playAgainButton2?.classList.add("hidden");
      },
      restart: restartGame
    };
  }

  // ../tmp/nova-games/c4/browser/src/game/game-local-2p.ts
  var GameLocal2p = class extends GameLocal {
  };
  function initGameLocal2p(firstPlayerName, secondPlayerName) {
    const firstPlayer = new PlayerHuman("\u{1F534}" /* PLAYER_1 */, firstPlayerName);
    const secondPlayer = new PlayerHuman("\u{1F535}" /* PLAYER_2 */, secondPlayerName);
    return initGameLocal(GameLocal2p, firstPlayer, secondPlayer);
  }

  // ../tmp/nova-games/c4/browser/src/game/game-local-ai.ts
  var GameLocalAi = class extends GameLocal {
  };
  function initGameLocalAi(playerName) {
    const firstPlayer = new PlayerHuman("\u{1F534}" /* PLAYER_1 */, playerName);
    const aiPlayer = new PlayerAi("\u{1F535}" /* PLAYER_2 */, `AI Player`);
    return initGameLocal(GameLocalAi, firstPlayer, aiPlayer);
  }

  // ../tmp/nova-games/c4/browser/src/game/game-online-2p.ts
  var GAME_MODE = ((GAME_MODE2) => {
    GAME_MODE2[GAME_MODE2["FIRST"] = "\u{1F534}" /* PLAYER_1 */] = "FIRST";
    GAME_MODE2[GAME_MODE2["SECOND"] = "\u{1F535}" /* PLAYER_2 */] = "SECOND";
    return GAME_MODE2;
  })(GAME_MODE || {});
  var statusbox3 = document.querySelector(".statusbox");
  var statusboxBodyGame3 = document.querySelector(".statusbox-body-game");
  var statusboxBodyConnection3 = document.querySelector(
    ".statusbox-body-connection"
  );
  var statusboxBodyPlayer3 = document.querySelector(".statusbox-body-player");
  var shareButton = document.querySelector(
    ".statusbox-button-share"
  );
  var C4_SERVER_ENDPOINT = false ? "" ? "" : `wss://c4-server.fly.dev/` : `ws://${location.hostname}:8080`;
  var GameOnline2p = class extends GameBase {
    controls;
    disposed = false;
    pendingMoveAnnouncement;
    connectionPlayerId = null;
    connectionMatchId = null;
    ws = null;
    gameMode;
    playerMain;
    playerShadow;
    constructor(players, board, { gameMode, playerName }) {
      super(players, board);
      this.gameMode = gameMode;
      if (gameMode === GAME_MODE.FIRST) {
        this.playerMain = players[0];
        this.playerShadow = players[1];
      } else {
        this.playerMain = players[1];
        this.playerShadow = players[0];
      }
      this.playerMain.label = playerName;
      this.initConnection();
    }
    reset() {
      this.pendingMoveAnnouncement = void 0;
      super.reset();
    }
    end() {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      this.controls?.setTurn(false);
      super.end();
      this.endConnection();
      shareButton.removeEventListener("click", this.showShareLink);
    }
    endConnection() {
      const ws = this.ws;
      this.ws = null;
      ws?.close();
    }
    initConnection() {
      console.log("initConnection");
      this.connectionPlayerId = null;
      this.connectionMatchId = null;
      if (this.ws) {
        this.ws.close();
      }
      const setStatusDisconnected = () => {
        this.ws = null;
        this.stopCurrentSession();
        this.isGameEnded = true;
        this.controls?.setTurn(false);
        if (statusboxBodyConnection3) {
          statusboxBodyConnection3.textContent = "Disconnected from server";
        }
        if (statusboxBodyGame3) {
          statusboxBodyGame3.textContent = `Game over`;
        }
        if (statusboxBodyPlayer3) {
          statusboxBodyPlayer3.textContent = `Disconnected from match`;
        }
      };
      const ws = new WebSocket(C4_SERVER_ENDPOINT);
      this.ws = ws;
      ws.addEventListener("message", (event) => {
        if (this.disposed || this.ws !== ws) {
          return;
        }
        this.messageActionHandler(parseMessage(event.data));
      });
      ws.addEventListener("open", () => {
        if (this.disposed || this.ws !== ws) {
          return;
        }
        ws.send(
          constructMessage("NEW_PLAYER_CONNECTION_REQUEST" /* NEW_PLAYER_CONNECTION_REQUEST */, {
            playerName: this.playerMain.label
          })
        );
        if (statusboxBodyConnection3) {
          statusboxBodyConnection3.textContent = "Connected to server";
        }
        announce("Connected to server.");
        if (statusboxBodyGame3) {
          statusboxBodyGame3.textContent = ``;
        }
        if (statusboxBodyPlayer3) {
          statusboxBodyPlayer3.textContent = ``;
        }
      });
      ws.addEventListener("close", (event) => {
        if (this.disposed || this.ws !== ws) {
          return;
        }
        console.log("[ws] close event", event);
        setStatusDisconnected();
      });
      ws.addEventListener("error", (event) => {
        if (this.disposed || this.ws !== ws) {
          return;
        }
        console.log("[ws] error event", event);
        setStatusDisconnected();
      });
    }
    initMatch = () => {
      if (this.ws && this.connectionPlayerId) {
        this.ws.send(
          constructMessage("NEW_MATCH_REQUEST" /* NEW_MATCH_REQUEST */, {
            playerId: this.connectionPlayerId
          })
        );
      }
    };
    connectToMatch = (matchId) => {
      if (!this.ws || !this.connectionPlayerId) {
        return;
      }
      this.ws.send(
        constructMessage("CONNECT_MATCH_REQUEST" /* CONNECT_MATCH_REQUEST */, {
          playerId: this.connectionPlayerId,
          matchId
        })
      );
    };
    messageActionHandler = (message) => {
      switch (message.type) {
        case "NEW_PLAYER_CONNECTION_OK" /* NEW_PLAYER_CONNECTION_OK */:
          {
            this.connectionPlayerId = message.payload.playerId;
            if (this.gameMode === GAME_MODE.FIRST) {
              this.initMatch();
            } else if (this.gameMode === GAME_MODE.SECOND) {
              const searchParams = new URLSearchParams(location.search);
              const connectionMatchId = searchParams.get("matchId");
              if (!connectionMatchId) {
                return;
              }
              this.connectToMatch(connectionMatchId);
            }
          }
          break;
        case "NEW_MATCH_OK" /* NEW_MATCH_OK */:
          {
            this.connectionMatchId = message.payload.matchId;
            shareButton.classList.remove("hidden");
            shareButton.removeEventListener("click", this.showShareLink);
            shareButton.addEventListener("click", this.showShareLink);
            this.showShareLink();
          }
          break;
        case "CONNECT_MATCH_OK" /* CONNECT_MATCH_OK */:
          {
            this.connectionMatchId = message.payload.matchId;
          }
          break;
        case "CONNECT_MATCH_FAIL" /* CONNECT_MATCH_FAIL */:
          {
            showMessage({
              title: "Error",
              messages: ["Failed to connect to match."]
            });
            if (statusboxBodyConnection3) {
              statusboxBodyConnection3.textContent = "Connection error";
            }
          }
          break;
        case "GAME_READY" /* GAME_READY */:
          {
            this.playerShadow.label = message.payload.otherPlayerName;
            showMessage({
              title: "Game started",
              messages: [
                `The first piece should be dropped by ${this.isCurrentMoveByCurrentPlayer() ? "you" : "the other player"}.`
              ]
            });
            if (statusboxBodyGame3) {
              statusboxBodyGame3.textContent = "Wating for move";
            }
            if (statusboxBodyPlayer3) {
              const currentPlayer = this.players[this.currentPlayerId];
              statusboxBodyPlayer3.textContent = `${currentPlayer.label} ${currentPlayer.boardPiece} ` + (this.isCurrentMoveByCurrentPlayer() ? `(you)` : `(the other player)`);
            }
            this.start();
          }
          break;
        case "MOVE_SHADOW" /* MOVE_SHADOW */:
          {
            this.playerShadow.doAction(message.payload.column);
          }
          break;
        case "GAME_ENDED" /* GAME_ENDED */:
          {
            this.isMoveAllowed = false;
            this.controls?.setTurn(false);
            this.pendingMoveAnnouncement = void 0;
            const { winnerBoardPiece } = message.payload;
            const winnerPlayer = this.players.find(
              (player) => player.boardPiece === winnerBoardPiece
            );
            const messageWinner = winnerBoardPiece === "D" /* DRAW */ ? `It's a draw` : winnerPlayer ? `${winnerPlayer.label} ${winnerPlayer.boardPiece} won` : `Player ${winnerBoardPiece === "\u{1F534}" /* PLAYER_1 */ ? "1 \u{1F534}" : "2 \u{1F535}"} won`;
            showMessage({
              title: "Thank you for playing",
              messages: [messageWinner, "Next game will start in 10 seconds."]
            });
            if (statusboxBodyGame3) {
              statusboxBodyGame3.textContent = "Game over";
            }
            if (statusboxBodyPlayer3) {
              statusboxBodyPlayer3.textContent = messageWinner;
            }
            announce(messageWinner);
          }
          break;
        case "GAME_RESET" /* GAME_RESET */:
          {
            this.controls?.setTurn(false);
            this.reset();
            renderBoardState(this.board, this.players);
          }
          break;
        case "OTHER_PLAYER_HUNGUP" /* OTHER_PLAYER_HUNGUP */:
          {
            this.stopCurrentSession();
            this.controls?.setTurn(false);
            showMessage({
              title: "Other player disconnected",
              messages: ["Please reload the page to start a new match."]
            });
            announce("Other player disconnected.");
          }
          break;
      }
    };
    showShareLink = () => {
      if (!this.connectionMatchId) {
        return;
      }
      const shareUrl = new URL(location.href);
      shareUrl.searchParams.set("matchId", this.connectionMatchId);
      console.log("[url] Share this", shareUrl.toString());
      showMessage({
        title: "Share this URL",
        messages: ["Share this URL with a friend to start the game."],
        render: (content) => {
          const label = document.createElement("label");
          label.htmlFor = "copy-box";
          label.textContent = "Game URL";
          const copyBox = document.createElement("input");
          copyBox.id = "copy-box";
          copyBox.className = "copy-box";
          copyBox.readOnly = true;
          copyBox.value = shareUrl.toString();
          const copyButton = document.createElement("button");
          copyButton.type = "button";
          copyButton.textContent = "Copy";
          copyButton.addEventListener("click", async () => {
            let isClipboardApiSuccessful = false;
            if (navigator.clipboard) {
              try {
                await navigator.clipboard.writeText(copyBox.value);
                isClipboardApiSuccessful = true;
              } catch (_err) {
              }
            }
            if (!isClipboardApiSuccessful) {
              copyBox.select();
              copyBox.setSelectionRange(0, 99999);
              document.execCommand("copy");
            }
          });
          content.append(label, copyBox, copyButton);
          copyBox.focus();
          copyBox.select();
        }
      });
    };
    /**
     * @returns true if the game is waiting for current player to make a move
     */
    isCurrentMoveByCurrentPlayer() {
      if (this.gameMode === GAME_MODE.FIRST) {
        return this.currentPlayerId === 0;
      } else {
        return this.currentPlayerId === 1;
      }
    }
    beforeMoveApplied = () => {
      this.controls?.setTurn(false);
      if (statusboxBodyGame3) {
        const currentPlayer = this.players[this.currentPlayerId];
        statusboxBodyGame3.textContent = `Dropping ${currentPlayer.boardPiece} disc`;
      }
    };
    waitingForMove = () => {
      renderBoardState(this.board, this.players);
      this.controls?.setTurn(
        this.isMoveAllowed && !this.isGameWon && !this.isGameEnded && this.isCurrentMoveByCurrentPlayer()
      );
      if (statusboxBodyGame3) {
        statusboxBodyGame3.textContent = "Wating for move";
      }
      const currentPlayer = this.players[this.currentPlayerId];
      const turnAnnouncement = `${currentPlayer.label}'s turn${this.isCurrentMoveByCurrentPlayer() ? " (you)" : ""}.`;
      if (statusboxBodyPlayer3) {
        statusboxBodyPlayer3.textContent = `${currentPlayer.label} ${currentPlayer.boardPiece} ` + (this.isCurrentMoveByCurrentPlayer() ? `(you)` : `(the other player)`);
      }
      announce(
        this.pendingMoveAnnouncement ? `${this.pendingMoveAnnouncement} It is now ${turnAnnouncement}` : turnAnnouncement
      );
      this.pendingMoveAnnouncement = void 0;
    };
    afterMove = (action) => {
      renderBoardState(this.board, this.players);
      const currentPlayer = this.players[this.currentPlayerId];
      const row = getMoveRow(this.board, action);
      this.pendingMoveAnnouncement = `${currentPlayer.label} placed a disc in column ${action + 1}${row ? `, row ${row}` : ""}.`;
      if (!this.connectionPlayerId || !this.connectionMatchId) {
        return;
      }
      if (this.ws && this.isCurrentMoveByCurrentPlayer()) {
        this.ws.send(
          constructMessage("MOVE_MAIN" /* MOVE_MAIN */, {
            playerId: this.connectionPlayerId,
            matchId: this.connectionMatchId,
            column: action
          })
        );
      }
    };
    announceWinner(winnerBoardPiece) {
      this.controls?.setTurn(false);
      super.announceWinner(winnerBoardPiece);
    }
  };
  function initGameOnline2p(playerName) {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      console.error("Canvas DOM is null");
      return;
    }
    const searchParams = new URLSearchParams(location.search);
    const connectionMatchId = searchParams.get("matchId");
    const gameMode = connectionMatchId ? GAME_MODE.SECOND : GAME_MODE.FIRST;
    const board = new Board(canvas);
    const players = gameMode === GAME_MODE.FIRST ? [
      new PlayerHuman("\u{1F534}" /* PLAYER_1 */, playerName),
      new PlayerShadow("\u{1F535}" /* PLAYER_2 */, `Other player`)
    ] : [
      new PlayerShadow("\u{1F534}" /* PLAYER_1 */, `Other player`),
      new PlayerHuman("\u{1F535}" /* PLAYER_2 */, playerName)
    ];
    const game = new GameOnline2p(players, board, {
      gameMode,
      playerName
    });
    let disposed = false;
    statusbox3?.classList.remove("hidden");
    statusboxBodyConnection3?.classList.remove("hidden");
    renderBoardState(board, players);
    function playColumn(column) {
      if (disposed) {
        return;
      }
      if (!game.isGameWon && !game.isGameEnded && game.isMoveAllowed && game.isCurrentMoveByCurrentPlayer()) {
        game.playerMain.doAction(column);
      }
    }
    function handleCanvasClick(event) {
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      controls.playColumn(getColumnFromCoord({ x, y }));
    }
    const controls = activateGameControls(
      playColumn,
      (column) => board.map[0][column] === " " /* EMPTY */
    );
    game.controls = controls;
    canvas.addEventListener("click", handleCanvasClick);
    return {
      end: () => {
        if (disposed) {
          return;
        }
        disposed = true;
        game.end();
        controls.dispose();
        canvas.removeEventListener("click", handleCanvasClick);
        board.dispose();
        statusbox3?.classList.add("hidden");
      }
    };
  }

  // ../tmp/nova-games/c4/browser/src/app.ts
  document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.querySelector(".section-canvas");
    if (!canvas) {
      console.error("Canvas element not found");
      return;
    }
    const initScreenDOM = document.querySelector(
      ".init-screen"
    );
    if (!initScreenDOM) {
      console.error("Mode element not found ");
      return;
    }
    let previewBoard = new Board(canvas);
    previewBoard.render();
    const searchParams = new URLSearchParams(location.search);
    const connectionMatchId = searchParams.get("matchId");
    const backToModeSelector = document.querySelector(
      ".statusbox-button-back"
    );
    const shareButton2 = document.querySelector(
      ".statusbox-button-share"
    );
    const playAgainButton3 = document.querySelector(
      ".statusbox-button-play-again"
    );
    const settingsForm = document.querySelector(
      ".game-settings-form"
    );
    if (!settingsForm) {
      console.error(".game-settings-form not found ");
      return;
    }
    const player1NameLabel = settingsForm.querySelector(
      ".game-settings-player-1-name-label"
    );
    const player2NameLabel = settingsForm.querySelector(
      ".game-settings-player-2-name-label"
    );
    const player1NameInput = settingsForm.querySelector(
      ".game-settings-player-1-name-input"
    );
    const player2NameInput = settingsForm.querySelector(
      ".game-settings-player-2-name-input"
    );
    let currentGameHandler = null;
    backToModeSelector?.classList.add("hidden");
    shareButton2?.classList.add("hidden");
    playAgainButton3?.classList.add("hidden");
    initScreenDOM.showModal();
    let chosenMode = connectionMatchId ? "online-human" : "offline-ai";
    renderForm();
    backToModeSelector?.addEventListener("click", () => {
      endCurrentGame();
      backToModeSelector?.classList.add("hidden");
      shareButton2?.classList.add("hidden");
      playAgainButton3?.classList.add("hidden");
      initScreenDOM.showModal();
    });
    playAgainButton3?.addEventListener("click", () => {
      currentGameHandler?.restart?.();
    });
    initScreenDOM.addEventListener("cancel", (ev) => {
      ev.preventDefault();
    });
    initScreenDOM.addEventListener("close", (ev) => {
      const formData = new FormData(settingsForm);
      const gameMode = formData.get("mode");
      const firstPlayerName = formData.get("player-1-name");
      const secondPlayerName = formData.get("player-2-name");
      initGame(gameMode, [firstPlayerName, secondPlayerName]);
    });
    settingsForm.addEventListener("input", (ev) => {
      const formData = new FormData(settingsForm);
      chosenMode = formData.get("mode");
      renderForm();
    });
    function renderForm() {
      if (connectionMatchId) {
        for (const el of settingsForm.querySelectorAll(
          ".game-settings-mode-input"
        )) {
          const checkboxEl = el;
          checkboxEl.readOnly = true;
          if (checkboxEl.value === "online-human") {
            checkboxEl.checked = true;
          } else {
            checkboxEl.checked = false;
          }
        }
        player2NameLabel.textContent = `Your name:`;
        player1NameInput.disabled = true;
        player2NameInput.disabled = false;
        player1NameLabel.classList.add("hidden");
        player1NameInput.classList.add("hidden");
        player2NameLabel.classList.remove("hidden");
        player2NameInput.classList.remove("hidden");
      } else if (chosenMode === "offline-human") {
        player1NameLabel.textContent = `First player's name:`;
        player2NameLabel.textContent = `Second player's name:`;
        player1NameLabel.classList.remove("hidden");
        player1NameInput.classList.remove("hidden");
        player2NameLabel.classList.remove("hidden");
        player2NameInput.classList.remove("hidden");
        player1NameInput.disabled = false;
        player2NameInput.disabled = false;
      } else if (chosenMode === "offline-ai") {
        player1NameLabel.textContent = `Player's name:`;
        player2NameLabel.textContent = `Player's name:`;
        player1NameLabel.classList.remove("hidden");
        player1NameInput.classList.remove("hidden");
        player2NameLabel.classList.add("hidden");
        player2NameInput.classList.add("hidden");
        player1NameInput.disabled = false;
        player2NameInput.disabled = true;
      } else if (chosenMode === "online-human") {
        player1NameLabel.textContent = `Your name:`;
        player2NameLabel.textContent = `Other player's name:`;
        player1NameLabel.classList.remove("hidden");
        player1NameInput.classList.remove("hidden");
        player2NameLabel.classList.add("hidden");
        player2NameInput.classList.add("hidden");
        player1NameInput.disabled = false;
        player2NameInput.disabled = true;
      } else if (chosenMode === "ai-vs-ai") {
        player1NameLabel.textContent = `Player's name:`;
        player2NameLabel.textContent = `Player's name:`;
        player1NameLabel.classList.add("hidden");
        player1NameInput.classList.add("hidden");
        player2NameLabel.classList.add("hidden");
        player2NameInput.classList.add("hidden");
        player1NameInput.disabled = true;
        player2NameInput.disabled = true;
      }
    }
    function initGame(chosenMode2, playerNames) {
      console.log("initGame chosenMode:", chosenMode2);
      endCurrentGame();
      previewBoard?.dispose();
      previewBoard = void 0;
      backToModeSelector?.classList.remove("hidden");
      playAgainButton3?.classList.add("hidden");
      if (chosenMode2 === "offline-human") {
        currentGameHandler = initGameLocal2p(
          playerNames[0] || "Player 1",
          playerNames[1] || "Player 2"
        );
      } else if (chosenMode2 === "offline-ai") {
        currentGameHandler = initGameLocalAi(playerNames[0] || "Player 1");
      } else if (chosenMode2 === "online-human") {
        currentGameHandler = initGameOnline2p(
          connectionMatchId ? playerNames[1] || "Player 2" : playerNames[0] || "Player 1"
        );
      } else if (chosenMode2 === "ai-vs-ai") {
        currentGameHandler = initGameAiVsAi();
      } else {
        console.error("Invalid game mode received", chosenMode2);
      }
    }
    function endCurrentGame() {
      currentGameHandler?.end();
      currentGameHandler = void 0;
    }
  });
})();
