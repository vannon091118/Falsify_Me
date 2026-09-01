// FalsifyMe TUI - begrenzter Ringbuffer
// Verantwortung: fixe Kapazitaet, aelteste Eintraege werden ueberschrieben.
// Pure, kein I/O.

export const createRing = (capacity = 200) => {
  if (!(capacity > 0)) capacity = 200;
  const buf = new Array(capacity);
  let head = 0; // naechster Schreibindex
  let size = 0;

  return {
    get capacity() { return capacity; },
    get length() { return size; },
    push(v) {
      buf[head] = v;
      head = (head + 1) % capacity;
      if (size < capacity) size += 1;
    },
    at(i) {
      if (i < 0 || i >= size) return undefined;
      return buf[(head - size + i + capacity) % capacity];
    },
    last() {
      return size > 0 ? buf[(head - 1 + capacity) % capacity] : undefined;
    },
    toArray() {
      const out = new Array(size);
      for (let i = 0; i < size; i++) out[i] = buf[(head - size + i + capacity) % capacity];
      return out;
    },
    clear() {
      head = 0;
      size = 0;
    },
  };
};