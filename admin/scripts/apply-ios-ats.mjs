#!/usr/bin/env node
/**
 * 给已生成的 iOS 工程写入 ATS 例外，允许访问默认后端的明文 HTTP。
 * npx cap add ios 会用模板盖掉 Info.plist，之后再跑一次本脚本。
 *
 *   node scripts/apply-ios-ats.mjs
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const plistPath = join(root, "ios/App/App/Info.plist");
const HOST = "47.239.0.90";
const BLOCK = `    <key>NSAppTransportSecurity</key>
    <dict>
        <key>NSExceptionDomains</key>
        <dict>
            <key>${HOST}</key>
            <dict>
                <key>NSExceptionAllowsInsecureHTTPLoads</key>
                <true/>
                <key>NSIncludesSubdomains</key>
                <false/>
            </dict>
        </dict>
    </dict>
`;

if (!existsSync(plistPath)) {
  console.error(`没有 ${plistPath}。先在本机执行 npx cap add ios，再运行本脚本。`);
  process.exit(1);
}

let xml = readFileSync(plistPath, "utf8");
if (xml.includes(`<key>${HOST}</key>`) && xml.includes("NSExceptionAllowsInsecureHTTPLoads")) {
  console.log("ATS 例外已在 Info.plist 中");
  process.exit(0);
}

if (xml.includes("<key>NSAppTransportSecurity</key>")) {
  console.error("Info.plist 已有 NSAppTransportSecurity，但没有该主机的例外。请手工合并，避免覆盖其它例外。");
  process.exit(1);
}

if (!xml.includes("</dict>\n</plist>") && !xml.includes("</dict>\r\n</plist>")) {
  console.error("无法识别 Info.plist 结尾");
  process.exit(1);
}

xml = xml.replace("</dict>\n</plist>", `${BLOCK}</dict>\n</plist>`).replace("</dict>\r\n</plist>", `${BLOCK}</dict>\r\n</plist>`);
writeFileSync(plistPath, xml);
console.log(`已写入 ${HOST} 的 ATS 例外`);
