(function attachClearField(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ClearField = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window, function createClearFieldApi() {
  "use strict";

  const STATUS = Object.freeze({
    READY: "ready",
    PLAYING: "playing",
    WON: "won",
    LOST: "lost",
  });

  class Game {
    constructor({ rows, columns, mines, random = Math.random }) {
      validateInteger("rows", rows, 4, 30);
      validateInteger("columns", columns, 4, 20);
      validateInteger("mines", mines, 1, rows * columns - 1);

      this.rows = rows;
      this.columns = columns;
      this.mines = mines;
      this.random = random;
      this.status = STATUS.READY;
      this.minesPlaced = false;
      this.cells = Array.from({ length: rows * columns }, (_, index) => ({
        index,
        row: Math.floor(index / columns),
        column: index % columns,
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        isExploded: false,
        isWrongFlag: false,
        adjacentMines: 0,
      }));
    }

    get isOver() {
      return this.status === STATUS.WON || this.status === STATUS.LOST;
    }

    get flaggedCount() {
      return this.cells.reduce((total, cell) => total + Number(cell.isFlagged), 0);
    }

    get minesRemaining() {
      return Math.max(0, this.mines - this.flaggedCount);
    }

    getCell(index) {
      return Number.isInteger(index) ? this.cells[index] ?? null : null;
    }

    getNeighborIndexes(index) {
      const cell = this.getCell(index);
      if (!cell) return [];

      const indexes = [];
      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (let columnOffset = -1; columnOffset <= 1; columnOffset += 1) {
          if (rowOffset === 0 && columnOffset === 0) continue;

          const row = cell.row + rowOffset;
          const column = cell.column + columnOffset;
          if (row < 0 || row >= this.rows || column < 0 || column >= this.columns) continue;

          indexes.push(row * this.columns + column);
        }
      }
      return indexes;
    }

    toggleFlag(index) {
      const cell = this.getCell(index);
      if (!cell || this.isOver || cell.isRevealed) {
        return this.createResult([], "ignored");
      }

      if (!cell.isFlagged && this.flaggedCount >= this.mines) {
        return this.createResult([], "flag-limit");
      }

      cell.isFlagged = !cell.isFlagged;
      return this.createResult([cell.index], cell.isFlagged ? "flagged" : "unflagged");
    }

    reveal(index) {
      const cell = this.getCell(index);
      if (!cell || this.isOver || cell.isFlagged) {
        return this.createResult([], "ignored");
      }

      if (!this.minesPlaced) {
        this.placeMines(index);
        this.status = STATUS.PLAYING;
      }

      const changed = new Set();

      if (cell.isRevealed) {
        this.revealNeighborsWhenSatisfied(cell, changed);
      } else if (cell.isMine) {
        this.triggerLoss(cell, changed);
      } else {
        this.revealSafeArea(cell.index, changed);
      }

      if (!this.isOver && this.hasWon()) {
        this.triggerWin(changed);
      }

      return this.createResult([...changed], "revealed");
    }

    placeMines(safeIndex) {
      if (this.minesPlaced) return;

      const safeZone = new Set([safeIndex, ...this.getNeighborIndexes(safeIndex)]);
      let candidates = this.cells
        .map((cell) => cell.index)
        .filter((index) => !safeZone.has(index));

      // On very dense custom boards, preserve at least the first selected cell.
      if (candidates.length < this.mines) {
        candidates = this.cells.map((cell) => cell.index).filter((index) => index !== safeIndex);
      }

      shuffleInPlace(candidates, this.random);
      candidates.slice(0, this.mines).forEach((index) => {
        this.cells[index].isMine = true;
      });

      this.cells.forEach((cell) => {
        if (cell.isMine) return;
        cell.adjacentMines = this.getNeighborIndexes(cell.index).reduce(
          (total, neighborIndex) => total + Number(this.cells[neighborIndex].isMine),
          0,
        );
      });

      this.minesPlaced = true;
    }

    revealSafeArea(startIndex, changed) {
      const queue = [startIndex];
      const queued = new Set(queue);

      while (queue.length > 0) {
        const index = queue.shift();
        const cell = this.cells[index];

        if (cell.isRevealed || cell.isFlagged || cell.isMine) continue;

        cell.isRevealed = true;
        changed.add(index);

        if (cell.adjacentMines !== 0) continue;

        this.getNeighborIndexes(index).forEach((neighborIndex) => {
          const neighbor = this.cells[neighborIndex];
          if (!neighbor.isMine && !neighbor.isFlagged && !neighbor.isRevealed && !queued.has(neighborIndex)) {
            queued.add(neighborIndex);
            queue.push(neighborIndex);
          }
        });
      }
    }

    revealNeighborsWhenSatisfied(cell, changed) {
      if (cell.adjacentMines === 0) return;

      const neighborIndexes = this.getNeighborIndexes(cell.index);
      const flagCount = neighborIndexes.reduce(
        (total, index) => total + Number(this.cells[index].isFlagged),
        0,
      );

      if (flagCount !== cell.adjacentMines) return;

      for (const neighborIndex of neighborIndexes) {
        const neighbor = this.cells[neighborIndex];
        if (neighbor.isFlagged || neighbor.isRevealed) continue;

        if (neighbor.isMine) {
          this.triggerLoss(neighbor, changed);
          return;
        }

        this.revealSafeArea(neighborIndex, changed);
      }
    }

    hasWon() {
      return this.cells.every((cell) => cell.isMine || cell.isRevealed);
    }

    triggerWin(changed) {
      this.status = STATUS.WON;
      this.cells.forEach((cell) => {
        if (cell.isMine && !cell.isFlagged) {
          cell.isFlagged = true;
          changed.add(cell.index);
        }
      });
    }

    triggerLoss(explodedCell, changed) {
      explodedCell.isRevealed = true;
      explodedCell.isExploded = true;
      changed.add(explodedCell.index);
      this.status = STATUS.LOST;

      this.cells.forEach((cell) => {
        if (cell.isMine) {
          cell.isRevealed = true;
          changed.add(cell.index);
        } else if (cell.isFlagged) {
          cell.isWrongFlag = true;
          changed.add(cell.index);
        }
      });
    }

    createResult(changedIndexes, reason) {
      return {
        changedIndexes,
        reason,
        status: this.status,
        minesRemaining: this.minesRemaining,
      };
    }
  }

  function validateInteger(name, value, min, max) {
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new RangeError(`${name} must be an integer between ${min} and ${max}.`);
    }
  }

  function shuffleInPlace(values, random) {
    for (let index = values.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(random() * (index + 1));
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  }

  return Object.freeze({ Game, STATUS });
});
