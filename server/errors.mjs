/** 统一的 HTTP 错误，index 按 e.s / e.code / e.message / e.extra 返回。 */
export class ApiError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.s = status;
    this.code = code;
    this.extra = extra;
  }
}
