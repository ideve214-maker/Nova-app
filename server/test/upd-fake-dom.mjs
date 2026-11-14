// 1.0.7 更新对话框测试用的极简 DOM：只够 33_update.js 挂对话框、读进度、点按钮。
export function fakeDocument() {
  const byId = {};
  const mk = () => {
    const el = {
      id: '', innerHTML: '', style: {}, attrs: {}, parentNode: null, _click: null, textContent: '',
      setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(t, fn) { if (t === 'click') this._click = fn; },
      appendChild(c) { c.parentNode = this; if (c.id) byId[c.id] = c; return c; },
      remove() { if (this.id) delete byId[this.id]; },
    };
    return el;
  };
  const body = mk();
  return {
    body, visibilityState: 'visible',
    addEventListener() {},
    createElement: () => mk(),
    getElementById: id => byId[id] || null,
    dialogHtml: () => (byId.upddlg ? byId.upddlg.innerHTML : ''),
    tap: action => byId.upddlg._click({target: {closest: () => ({getAttribute: () => action})}}),
  };
}
export const tick = (ms = 30) => new Promise(r => setTimeout(r, ms));
