# BiomedKG 项目规则

## 1. GitHub 自动推送（重要）

**用户明确要求：每次修改后必须推送到 GitHub。**

流程：

1. 修改代码
2. 跑验证：
   - JS 语法严格检查（用 `vm.Script`，不用 `node --check`，后者会漏检）
   ```powershell
   node -e "const fs=require('fs'),vm=require('vm'); try{ new vm.Script(fs.readFileSync('src/js/xxx.js','utf8')); console.log('OK'); }catch(e){ console.log('FAIL: '+e.message); }"
   ```
   - 本地起服务验证渲染
3. `git add` 相关文件（注意 `.gitignore` 已排除截图、缓存）
4. `git commit`（中文说明改动点）
5. `git push`

若推送失败（网络/443 重置/超时）：

1. 先重试 1–2 次
2. 仍失败则启动 Watt Toolkit 加速：
   ```powershell
   if (-not (Get-Process -Name "Steam++" -ErrorAction SilentlyContinue)) { Start-Process "C:\Program Files\Watt Toolkit\Steam++.exe" }
   ```
   提醒用户在 GUI 里点「启动加速」并同意 UAC
3. 若已开 VPN，优先用 VPN，不叠加 Watt
4. **不要把失败静默吞掉**，要告知用户

工作完成后按全局规则**完全退出 Watt**（不留后台进程）。

## 2. 部署

修改前端后同步到阿里云服务器：

```powershell
$pem = "D:\dsh-workspace\服务器相关\_yzk_kskbl.pem"
scp -i $pem -r "src\index.html" "src\js" "src\css" "src\data" root@47.99.114.48:/var/www/medical-kg/
```

**重要**：改完必须更新 `index.html` 里的版本号（`?v=YYYYMMDDx`），否则浏览器缓存旧 JS 会导致页面显示异常。

## 3. 项目结构约定

```
src/           前端源码（部署到服务器的是这一层）
scripts/       数据抓取与转换脚本（不部署）
docs/          文档
```

- 截图/预览图一律不入库（`.gitignore` 已排除 `*.png`）
- 数据文件 `src/data/graph-data.js` 是自动生成的，不要手改，改 `scripts/convert_data.py`

## 4. 技术要点备忘

- **必须通过 HTTP 访问**：`file://` 协议下 `<script src>` 多目录加载会被 CORS 拦截
- **JS 校验用 `vm.Script`**：`node --check` 会漏检"注释吞掉代码"这类错误
- **移动端性能**：`_isMobile` 判定后自动降级（DPR、节点数、帧率、粒子）
- **布局别用硬边界**：硬截断会让节点挤成四边条带，用软约束
