import { describe, expect, it } from "vitest";
import { normPrice, yuanText } from "./marketing";

describe("推流套餐价格输入（小数）", () => {
  it("可以输入小数点和两位小数", () => {
    expect(normPrice("9")).toBe("9");
    expect(normPrice("9.")).toBe("9.");
    expect(normPrice("9.9")).toBe("9.9");
    expect(normPrice("9.99")).toBe("9.99");
    expect(normPrice(".5")).toBe(".5");
  });
  it("中文逗号、句号当作小数点", () => {
    expect(normPrice("9，9")).toBe("9.9");
    expect(normPrice("9。9")).toBe("9.9");
    expect(normPrice("9,9")).toBe("9.9");
  });
  it("拒绝三位小数、字母和多个小数点", () => {
    expect(normPrice("9.999")).toBeNull();
    expect(normPrice("9a")).toBeNull();
    expect(normPrice("9.9.9")).toBeNull();
  });
  it("分转元显示，9.9 元存为 990 分", () => {
    expect(yuanText(990)).toBe("9.9");
    expect(yuanText(999)).toBe("9.99");
    expect(yuanText(2900)).toBe("29");
    expect(Math.round(Number(normPrice("9.9")) * 100)).toBe(990);
    expect(Math.round(Number(normPrice("0.07")) * 100)).toBe(7);
  });
});
