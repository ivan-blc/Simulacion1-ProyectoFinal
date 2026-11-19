export function createHud(): (text: string) => void {
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:8px;left:8px;padding:6px 8px;background:rgba(0,0,0,.6);' +
    'color:#fff;font:12px monospace;white-space:pre;pointer-events:none;z-index:10';
  document.body.appendChild(el);
  return (text: string) => {
    el.textContent = text;
  };
}