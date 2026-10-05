import { DockerCompileRunner } from './docker';
import { CompileService } from './service';

let service: CompileService | undefined;
export const getCompileService = (): CompileService =>
  (service ??= new CompileService({ runner: new DockerCompileRunner() }));
/** Для тестов: подменить сервис (или сбросить, передав undefined). */
export const setCompileService = (s: CompileService | undefined): void => {
  service = s;
};
