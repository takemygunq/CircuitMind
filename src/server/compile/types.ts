export interface CompileRequest {
  fqbn: string;
  code: string;
}

export interface CompileDiagnostic {
  severity: 'error' | 'warning';
  line: number;
  column?: number;
  message: string;
}

export interface CompileSizes {
  flashUsed: number;
  flashMax: number;
  ramUsed?: number;
  ramMax?: number;
}

export interface CompileResult {
  ok: boolean;
  /** Хвост журнала arduino-cli (до 20 000 символов). */
  log: string;
  diagnostics: CompileDiagnostic[];
  /** Intel HEX (Arduino AVR) — готов для эмулятора и загрузки. */
  hex?: string;
  /** Прочие артефакты (.uf2 / .bin) в base64. */
  files: Record<string, string>;
  sizes?: CompileSizes;
  durationMs: number;
  timedOut?: boolean;
  cached?: boolean;
}

export interface CompileRunner {
  run(req: CompileRequest, timeoutMs: number): Promise<CompileResult>;
  /** Готов ли компилятор (Docker запущен и образ собран). */
  available(): Promise<boolean>;
}
