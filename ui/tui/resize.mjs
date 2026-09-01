// FalsifyMe TUI - Resize-Oberwachung
// Verantwortung: Terminal-Dimensionen erkennen OHNE Verlass auf das
// unzuverlaessige 'resize'-Event (Windows, node#13197). Polling + Coalescing:
// Resize-Spam -> EIN onResize. Kein React-Import.
export const createResize = ({ getSize, onResize, intervalMs = 500, debounceMs = 40 } = {}) => {
  let last = null;
  let timer = null;
  let iv = null;

  const check = () => {
    const size = getSize();
    if (!last) {
      last = size;
      return;
    }
    if (size.cols !== last.cols || size.rows !== last.rows) {
      last = size;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        onResize?.(size);
      }, debounceMs);
    }
  };

  return {
    get size() {
      return last ? { ...last } : null;
    },
    start() {
      if (iv !== null) return;
      check();
      iv = setInterval(check, intervalMs);
    },
    stop() {
      if (iv !== null) clearInterval(iv);
      iv = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
};