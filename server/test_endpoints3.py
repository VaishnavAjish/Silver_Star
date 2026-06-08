import urllib.request
import urllib.error
import json

endpoints = [
    '/api/inventory',
    '/api/inventory/lots',
    '/api/inventory/summary',
    '/api/dashboard',
    '/api/dashboard/widgets',
    '/api/lot-process-issues',
    '/api/machines',
    '/api/items',
    '/api/inventory/filters/active',
    '/api/lot-movements'
]

try:
    with open('token.txt', 'r') as f:
        token = f.read().strip()
    
    for ep in endpoints:
        req = urllib.request.Request(f'http://localhost:5001{ep}', headers={'Authorization': f'Bearer {token}'})
        try:
            res = urllib.request.urlopen(req)
            print(f"{ep}: {res.status}")
        except urllib.error.HTTPError as e:
            print(f"{ep}: HTTP {e.code}")
            if e.code == 500:
                print("Body:", e.read().decode('utf-8'))
        except Exception as e:
            print(f"{ep}: Error {e}")
except Exception as e:
    print(f"Error: {e}")
