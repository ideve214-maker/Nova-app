// 测试用：从 vendored @kinsh/vodozemac-wasm（CJS，启动时已实例化）加载 Account / Session。
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
const req = createRequire(join(dirname(fileURLToPath(import.meta.url)), '../../vendor/vodozemac/pkg-node/package.json'));
export const {Account, Session, InboundResult} = req('./kinsh_vodozemac_wasm.js');
