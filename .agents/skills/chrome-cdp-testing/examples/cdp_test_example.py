#!/usr/bin/env python3
"""
Chrome CDP 自动化测试示例脚本
用法: python3 cdp_test_example.py

此脚本展示了如何通过 CDP 连接 Chrome 浏览器进行自动化测试。
前提: 用户的 Chrome 已启用远程调试（端口 39222）。
"""

import asyncio
import json
import base64
import websockets
import urllib.request
import sys
import os

# ═══ 配置 ═══
CDP_PORT = 39222  # 用户 Chrome 的调试端口（不是 IDE 的 9222）
TIMEOUT = 30  # 超时秒数


async def main():
    print("═══ Chrome CDP 自动化测试 ═══")
    print()

    # ─── 1. 发现 Chrome 实例 ─── 
    try:
        targets = json.loads(
            urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json').read()
        )
        page_targets = [t for t in targets if t.get('type') == 'page']
        print(f"✅ 连接 Chrome CDP 成功，发现 {len(page_targets)} 个页面")
    except Exception as e:
        print(f"❌ 无法连接 Chrome CDP: {e}")
        print(f"   确认 Chrome 已启用远程调试: --remote-debugging-port={CDP_PORT}")
        sys.exit(1)

    if not page_targets:
        print("❌ 没有可用的页面 target")
        sys.exit(1)

    target = page_targets[0]
    ws_url = target['webSocketDebuggerUrl']
    print(f"   使用页面: {target.get('title', '?')}")
    print(f"   URL: {target.get('url', '?')}")
    print()

    # ─── 2. CDP 通信基础设施 ───
    msg_id = 0

    async def send_cmd(ws, method, params={}):
        nonlocal msg_id
        msg_id += 1
        await ws.send(json.dumps({'id': msg_id, 'method': method, 'params': params}))
        resp = json.loads(await ws.recv())
        while resp.get('id') != msg_id:
            resp = json.loads(await ws.recv())
        return resp

    async def click(ws, x, y):
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mousePressed', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1
        })
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mouseReleased', 'x': x, 'y': y,
            'button': 'left', 'clickCount': 1
        })

    async def move_mouse(ws, x, y):
        await send_cmd(ws, 'Input.dispatchMouseEvent', {
            'type': 'mouseMoved', 'x': x, 'y': y
        })

    async def evaluate(ws, expr):
        r = await send_cmd(ws, 'Runtime.evaluate', {
            'expression': expr, 'returnByValue': True
        })
        return r.get('result', {}).get('result', {}).get('value')

    async def screenshot(ws, name):
        r = await send_cmd(ws, 'Page.captureScreenshot', {'format': 'png'})
        img = base64.b64decode(r['result']['data'])
        filepath = f'{name}.png'
        with open(filepath, 'wb') as f:
            f.write(img)
        print(f"  📸 {filepath} ({len(img)} bytes)")
        return filepath

    # ─── 3. 执行测试 ───
    async with websockets.connect(ws_url, max_size=50 * 1024 * 1024) as ws:
        # 导航到目标页面
        test_url = sys.argv[1] if len(sys.argv) > 1 else 'about:blank'
        print(f"导航到: {test_url}")
        await send_cmd(ws, 'Page.navigate', {'url': test_url})
        await asyncio.sleep(3)

        # 获取页面信息
        title = await evaluate(ws, 'document.title')
        print(f"  页面标题: {title}")

        # 检查 Canvas（如果是游戏）
        canvas_info = await evaluate(ws, '''
            (function() {
                var c = document.getElementById("c") || document.querySelector("canvas");
                if (!c) return "no_canvas";
                var r = c.getBoundingClientRect();
                return JSON.stringify({
                    x: r.x, y: r.y, w: r.width, h: r.height,
                    designW: c.width, designH: c.height
                });
            })()
        ''')
        if canvas_info and canvas_info != 'no_canvas':
            info = json.loads(canvas_info)
            print(f"  Canvas: {info['designW']}x{info['designH']} "
                  f"(显示: {info['w']:.0f}x{info['h']:.0f} at ({info['x']:.0f},{info['y']:.0f}))")

        # 截图
        await screenshot(ws, 'cdp_test')
        print()
        print("═══ 测试完成 ═══")


if __name__ == '__main__':
    asyncio.run(main())
