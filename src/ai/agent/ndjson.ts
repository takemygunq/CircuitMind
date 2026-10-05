/** Инкрементальный разбор NDJSON: чанки могут рваться посреди строки; пустые строки (heartbeat) пропускаются. */
export class NdjsonParser<T extends { type: string } = import('./events').AgentEvent> {
  private buffer = '';
  push(chunk: string): T[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    return lines.flatMap((l) => this.parse(l));
  }
  /** Остаток после конца потока (последняя строка без перевода строки). */
  flush(): T[] {
    const rest = this.buffer;
    this.buffer = '';
    return this.parse(rest);
  }
  private parse(line: string): T[] {
    const t = line.trim();
    if (!t) return [];
    try {
      const e = JSON.parse(t) as T;
      return e && typeof e.type === 'string' ? [e] : [];
    } catch {
      return []; // битую строку пропускаем: поток важнее одной записи
    }
  }
}
