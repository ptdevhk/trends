
import asyncio
import json
import urllib.request
import websockets
import sys

CDP_PORT = 9222

async def run():
    # 1. Get browser targets
    try:
        resp = urllib.request.urlopen(f'http://127.0.0.1:{CDP_PORT}/json').read()
        targets = json.loads(resp)
    except Exception as e:
        print(f"Error connecting to CDP: {e}")
        return

    # 2. Find target
    target = next((p for p in targets if 'hr.job5156.com' in (p.get('url') or '')), None)
    if not target:
        print("Target not found. Open hr.job5156.com in Chrome.")
        return

    print(f"Connecting to {target.get('title')}...")
    
    async with websockets.connect(target['webSocketDebuggerUrl'], max_size=10**8) as ws:
        msg_id = 0
        
        async def call(method, params=None):
            nonlocal msg_id
            msg_id += 1
            await ws.send(json.dumps({"id": msg_id, "method": method, "params": params or {}}))
            while True:
                resp = json.loads(await ws.recv())
                if resp.get("id") == msg_id:
                    return resp.get("result", {})

        # Enable runtime
        await call("Runtime.enable")

        # 3. Check window.__TR_RESUME_DATA__ status
        status_eval = await call("Runtime.evaluate", {
            "expression": "JSON.stringify(window.__TR_RESUME_DATA__ ? window.__TR_RESUME_DATA__.status() : null)",
            "returnByValue": True
        })
        status_json = status_eval.get("result", {}).get("value")
        print(f"\nAPI Status:\n{status_json}")

        # 4. Check DOM elements for pagination
        dom_eval = await call("Runtime.evaluate", {
            "expression": """
            JSON.stringify((() => {
                const p = document.querySelector('.el-pagination');
                const btn = document.querySelector('.el-pagination .btn-next');
                const btn2 = document.querySelector('.btn-next');
                return {
                    pagination_html: p ? p.outerHTML.substring(0, 200) + '...' : null,
                    pagination_text: p ? p.textContent : null,
                    btn_selector_found: !!btn,
                    btn_class: btn ? btn.className : null,
                    btn_disabled: btn ? btn.disabled : null,
                    btn_attributes: btn ? btn.getAttributeNames().reduce((acc, name) => ({...acc, [name]: btn.getAttribute(name)}), {}) : null,
                    btn_fallback_found: !!btn2
                };
            })())
            """,
            "returnByValue": True
        })
        dom_json = dom_eval.get("result", {}).get("value")
        print(f"\nDOM Debug:\n{dom_json}")

        # 5. Try calling goToNextPage
        print("\nAttempting goToNextPage()...")
        next_eval = await call("Runtime.evaluate", {
            "expression": "JSON.stringify(window.__TR_RESUME_DATA__.goToNextPage())",
            "returnByValue": True
        })
        print(f"Result: {next_eval.get('result', {}).get('value')}")


if __name__ == "__main__":
    asyncio.run(run())
