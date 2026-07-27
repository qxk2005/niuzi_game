---
name: Chrome CDP 自动化测试
description: |
  当需要通过 Chrome DevTools Protocol (CDP) 对网页/游戏进行自动化测试时使用此技能。
  包括截图、模拟鼠标点击、执行 JavaScript、验证页面状态等。
  特别适用于 Canvas 游戏和交互式网页的自动化测试。
  当 browser_subagent 工具无法使用时，这是可靠的替代方案。
---

# Chrome CDP 自动化测试技能

## 背景

Antigravity IDE 的内置 `browser_subagent` / `open_browser_url` 工具使用 Playwright 连接端口 9222 的 Chrome 实例。
但 IDE 的 `language_server` 进程会占用这个 CDP WebSocket 连接，导致 Playwright 返回以下错误：

```
failed to create browser context: failed to connect to browser via CDP:
Unexpected status 400 when connecting to http://127.0.0.1:9222/json/version/
This does not look like a DevTools server, try connecting via ws://
```

**解决方案**：直接通过 Python + `websockets` 库连接用户自己的 Chrome 浏览器（通常在端口 39222）。

## 前提条件

### 1. 确认用户的 Chrome 已启用远程调试

```bash
# 检查是否有带 remote-debugging-port 的 Chrome 进程
ps aux | grep -i "remote-debugging-port" | grep -v grep
```

用户的 Chrome 通常在端口 **39222**（不是 9222）。端口 9222 是 IDE 的内部浏览器。

### 2. 确认 websockets 库可用

```bash
python3 -c "import websockets; print('websockets OK')"
```

如果没有安装：`pip3 install websockets`

### 3. 确认 CDP 端口可访问

```bash
curl -s http://127.0.0.1:39222/json | python3 -m json.tool | head -20
```

## 核心代码模板

### 完整测试脚本模板

```python
import asyncio
import json
import base64
import websockets
import urllib.request

async def main():
    # ═══ 步骤1：发现并连接 Chrome ═══
    # 获取所有可用的页面 targets
    targets = json.loads(urllib.request.urlopen('http://127.0.0.1:39222/json').read())
    page_targets = [t for t in targets if t.get('type') == 'page']
    
    # 使用第一个可用页面
    target = page_targets[0]
    ws_url = target['webSocketDebuggerUrl']
    
    # ═══ 步骤2：CDP 命令发送器 ═══
    msg_id = 0
    async def send_cmd(ws, method, params={}):
        nonlocal msg_id
        msg_id += 1
        await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params}))
        resp = json.loads(await ws.recv())
        # 跳过事件消息，等待匹配的响应
        while resp.get('id') != msg_id:
            resp = json.loads(await ws.recv())
        return resp
    
    # ═══ 步骤3：工具函数 ═══
    async def click(ws, x, y):
        """模拟鼠标点击（按下+释放）"""
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': x, 'y': y, 
            'button': 'left', 'clickCount': 1
        })
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': x, 'y': y, 
            'button': 'left', 'clickCount': 1
        })
    
    async def moveMouse(ws, x, y):
        """模拟鼠标移动"""
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mouseMoved', 'x': x, 'y': y
        })
    
    async def evaluate(ws, expr):
        """执行 JavaScript 并返回结果"""
        r = await send_cmd(ws, 'Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        return r.get('result', {}).get('result', {}).get('value')
    
    async def screenshot(ws, name):
        """截图并保存为 PNG 文件"""
        r = await send_cmd(ws, 'Page.captureScreenshot', {'format': 'png'})
        img = base64.b64decode(r['result']['data'])
        with open(f'{name}.png', 'wb') as f:
            f.write(img)
        print(f'📸 {name}.png ({len(img)} bytes)')
    
    # ═══ 步骤4：连接并执行测试 ═══
    async with websockets.connect(ws_url, max_size=50*1024*1024) as ws:
        # 导航到目标页面（可用 file:// 或 http://）
        await send_cmd(ws, 'Page.navigate', {
            'url': 'file:///path/to/your/page.html'
        })
        await asyncio.sleep(3)  # 等待页面加载
        
        # 获取 Canvas 位置和缩放比例（用于 Canvas 游戏）
        r = await send_cmd(ws, 'Runtime.evaluate', {
            'expression': '''
                var r = document.getElementById("c").getBoundingClientRect();
                r.x + "," + r.y + "," + r.width + "," + r.height
            '''
        })
        parts = r['result']['result']['value'].split(',')
        ox, oy, w, h = float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3])
        # 设计分辨率到实际分辨率的缩放
        sx, sy = w / 960, h / 640  # 根据实际 Canvas 设计分辨率调整
        
        # 截图
        await screenshot(ws, 'test_screenshot')
        
        # 模拟点击（使用缩放后的坐标）
        await click(ws, ox + 480 * sx, oy + 320 * sy)

asyncio.run(main())
```

## 关键注意事项

### 端口选择
- **39222**: 用户自己的 Chrome 浏览器 ✅（推荐）
- **9222**: IDE 的内部浏览器 ❌（被 language_server 占用）

### 新建标签页
在 Chrome 150+ 版本中，创建新标签页需要使用 **PUT** 方法：
```python
import urllib.request
req = urllib.request.Request(
    f'http://127.0.0.1:39222/json/new?{encoded_url}',
    method='PUT'
)
resp = urllib.request.urlopen(req)
```

### Canvas 坐标转换
对于 Canvas 游戏，鼠标事件使用的是**浏览器视口坐标**，不是 Canvas 内部坐标：
```python
# 1. 获取 Canvas 在视口中的位置
r = document.getElementById("c").getBoundingClientRect()
ox, oy = r.x, r.y  # Canvas 左上角在视口中的位置

# 2. 计算缩放比例
sx = canvas_actual_width / canvas_design_width   # 例如 w/960
sy = canvas_actual_height / canvas_design_height  # 例如 h/640

# 3. 将游戏内坐标转换为视口坐标
viewport_x = ox + game_x * sx
viewport_y = oy + game_y * sy
```

### WebSocket 消息处理
CDP WebSocket 会发送**事件消息**（无 `id` 字段）。在等待命令响应时，必须跳过这些事件：
```python
resp = json.loads(await ws.recv())
while resp.get('id') != expected_id:
    resp = json.loads(await ws.recv())
```

### max_size 参数
截图数据可能很大，必须设置足够大的 `max_size`：
```python
websockets.connect(ws_url, max_size=50*1024*1024)  # 50MB
```

### 页面导航
- 优先使用 `file://` 协议直接打开本地文件（不需要 HTTP 服务器）
- URL 中的中文需要 percent-encode：`%E5%83%B5%E5%B0%B8` = "僵尸"
- 导航后至少等待 2-3 秒让页面加载完成

### IIFE 内部状态访问
如果游戏逻辑在 IIFE 内部，无法直接从外部访问 `game` 对象。可以：
1. 在代码中添加 `document.querySelector('canvas').__game = game;` 暴露引用
2. 通过 DOM 事件间接测试（推荐）
3. 通过截图视觉验证游戏状态

## 常用 CDP 命令参考

| 命令 | 用途 |
|------|------|
| `Page.navigate` | 导航到 URL |
| `Page.captureScreenshot` | 页面截图 |
| `Runtime.evaluate` | 执行 JavaScript |
| `Runtime.enable` | 启用运行时事件 |
| `Input.dispatchMouseEvent` | 模拟鼠标事件 |
| `Input.dispatchKeyEvent` | 模拟键盘事件 |
| `DOM.getDocument` | 获取 DOM 树 |

## 故障排除

### 连接被拒绝
```bash
# 确认 Chrome 进程正在运行
ps aux | grep -i chrome | grep remote-debugging-port
# 确认端口可达
curl -s http://127.0.0.1:39222/json/version
```

### WebSocket 超时
增加 `asyncio.sleep()` 等待时间，特别是在页面加载和复杂 JavaScript 执行后。

### 截图全黑
- 确保页面已完全加载（增加等待时间）
- Canvas 游戏可能需要先触发渲染（如点击开始按钮）
